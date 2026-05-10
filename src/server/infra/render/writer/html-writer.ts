import path from 'node:path'

import type {ElementName, ValidationError} from '../../../core/domain/render/element-types.js'

import {DirectoryManager} from '../../../core/domain/knowledge/directory-manager.js'
import {ELEMENT_NAMES} from '../../../core/domain/render/element-types.js'
import {ELEMENT_REGISTRY} from '../elements/registry.js'
import {parseHtml, stripCodeFenceWrapper, walkElements} from '../reader/html-parser.js'

/**
 * HTML writer for the curate context-tree.
 *
 * Consumes the LLM's text response (the curate agent's final output),
 * validates it against the element registry, and atomically writes the
 * topic file to disk. `stripCodeFenceWrapper` handles the model's
 * stubborn habit of wrapping responses in code fences (~70% of the time
 * on Sonnet 4.5 per the authoring fluency check).
 *
 * Sequence on every write:
 *   1. Strip a single outer ` ```<lang>? … ``` ` wrapper if present.
 *   2. Parse with parse5 (forgiving — never throws).
 *   3. Walk the parsed tree; require exactly one `<bv-topic>` root and
 *      a `path` attribute. Validate every typed `<bv-*>` element through
 *      its registered validator. Reject on any failure.
 *   4. Resolve the on-disk path via the topic's `path` attribute (relative
 *      to a project's context-tree root) and atomically write the cleaned
 *      HTML via the existing `tmp-rename` pattern.
 *
 * On validation failure: returns a structured result for the executor
 * to log + surface as a curate-status. No file is written; the writer
 * fails clean. (Salvage mode for partial recovery is future work.)
 */

export type HtmlWriteSuccess = {
  /** Absolute path of the file that was written. */
  filePath: string
  ok: true
  /** The cleaned HTML actually persisted (after fence-stripping). */
  written: string
}

export type HtmlWriteFailure = {
  errors: readonly HtmlWriteError[]
  ok: false
}

export type HtmlWriteResult = HtmlWriteFailure | HtmlWriteSuccess

export type HtmlWriteError =
  | {field: string; kind: 'attribute-validation'; message: string; tag: ElementName}
  | {kind: 'missing-bv-topic'; message: string}
  | {kind: 'missing-path-attribute'; message: string}
  | {kind: 'multiple-bv-topic'; message: string}
  | {kind: 'unknown-bv-element'; message: string; tag: string}

export type HtmlWriteOptions = {
  /**
   * Project root directory. The topic file is written to
   * `<contextTreeRoot>/<topic.path>.html` relative to this root.
   */
  contextTreeRoot: string
  /** Raw LLM response text. May be wrapped in a code fence. */
  rawHtml: string
}

/**
 * Validate and atomically write a curate output as an HTML topic file.
 */
export async function writeHtmlTopic(options: HtmlWriteOptions): Promise<HtmlWriteResult> {
  const {contextTreeRoot, rawHtml} = options
  const cleaned = stripCodeFenceWrapper(rawHtml)

  const validation = validateHtmlTopic(cleaned)
  if (!validation.ok) {
    return {errors: validation.errors, ok: false}
  }

  const filePath = topicPathToFilePath(contextTreeRoot, validation.topicPath)
  await DirectoryManager.writeFileAtomic(filePath, cleaned)

  return {filePath, ok: true, written: cleaned}
}

type ValidatedTopic =
  | {errors: readonly HtmlWriteError[]; ok: false}
  | {ok: true; topicPath: string}

/**
 * Pure validation pass — does not touch disk. Exposed so the executor
 * can verify a response before deciding to write (e.g., for status
 * pre-checks) without paying the I/O cost twice.
 */
export function validateHtmlTopic(html: string): ValidatedTopic {
  const errors: HtmlWriteError[] = []

  const elements = walkElements(parseHtml(html))
  const topics = elements.filter((e) => e.tagName === 'bv-topic')

  if (topics.length === 0) {
    errors.push({
      kind: 'missing-bv-topic',
      message: 'Curate output must contain exactly one <bv-topic> root element. Found 0.',
    })
    return {errors, ok: false}
  }

  if (topics.length > 1) {
    errors.push({
      kind: 'multiple-bv-topic',
      message: `Curate output must contain exactly one <bv-topic> root. Found ${topics.length}.`,
    })
    return {errors, ok: false}
  }

  const topic = topics[0]
  const topicPath = topic.attributes.path
  if (!topicPath || topicPath.trim().length === 0) {
    errors.push({
      kind: 'missing-path-attribute',
      message: '<bv-topic> must declare a non-empty `path` attribute.',
    })
  }

  for (const el of elements) {
    if (!el.tagName.startsWith('bv-')) continue

    if (!isRegisteredElementName(el.tagName)) {
      errors.push({
        kind: 'unknown-bv-element',
        message: `<${el.tagName}> is not in the element registry. Vocabulary is closed.`,
        tag: el.tagName,
      })
      continue
    }

    const result = ELEMENT_REGISTRY[el.tagName].validator(el)
    if (!result.valid) {
      for (const e of result.errors) {
        errors.push(toAttributeError(el.tagName, e))
      }
    }
  }

  if (errors.length > 0) {
    return {errors, ok: false}
  }

  return {ok: true, topicPath: topicPath as string}
}

function isRegisteredElementName(tag: string): tag is ElementName {
  return (ELEMENT_NAMES as readonly string[]).includes(tag)
}

function toAttributeError(tag: ElementName, error: ValidationError): HtmlWriteError {
  return {field: error.field, kind: 'attribute-validation', message: error.message, tag}
}

/**
 * Resolve a `<bv-topic path="...">` attribute to an absolute on-disk
 * path inside the project's context-tree directory. The topic path is
 * sanitised: backslashes normalised to forward slashes, leading slashes
 * stripped, `..` segments rejected. The current storage layout is
 * `.brv/context-tree/`; this resolver is the single point that
 * encodes that convention.
 */
function topicPathToFilePath(contextTreeRoot: string, topicPath: string): string {
  const normalized = topicPath.replaceAll('\\', '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter((s) => s.length > 0)

  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error(`bv-topic path may not contain "${segment}" segment: ${topicPath}`)
    }
  }

  const relative = segments.join('/') + '.html'
  const resolved = path.resolve(contextTreeRoot, relative)

  // Defence in depth: ensure the resolved path stays under contextTreeRoot.
  const rootResolved = path.resolve(contextTreeRoot)
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error(`bv-topic path escapes the context-tree root: ${topicPath}`)
  }

  return resolved
}
