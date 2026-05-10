import {readFile} from 'node:fs/promises'

import type {ElementName} from '../../../core/domain/render/element-types.js'

import {ELEMENT_NAMES} from '../../../core/domain/render/element-types.js'
import {getInnerText, parseHtml, walkElements} from './html-parser.js'

/**
 * Topic-file reader for the HTML render layer.
 *
 * Parses an HTML topic via parse5, extracts BM25-ready text content,
 * and produces a flat list of every typed `<bv-*>` element with its
 * tag and attributes. The element list is consumed by the
 * element-axis index for structural lookups; the inner text is fed
 * into the BM25 index alongside markdown bodies.
 *
 * Inner text is already entity-decoded by parse5 (the parser handles
 * `&amp;` → `&`, `&lt;` → `<`, etc. at parse time), so the tokenizer
 * sees plain text and ranking parity with markdown is straightforward.
 */

/**
 * One typed `<bv-*>` element discovered in a topic. Attributes are a
 * snapshot of the parsed attribute map (lowercase keys per HTML5
 * normalization). Used by the element-axis index for `tag → [paths]`
 * and `tag.attribute=value → [paths]` lookups.
 */
export type ElementAxisEntry = {
  attributes: Readonly<Record<string, string>>
  tag: ElementName
}

/**
 * Topic-level frontmatter attributes lifted off `<bv-topic>` for
 * convenience. Consumers that need the full attribute set walk the
 * elements list directly.
 */
export type TopicAttributes = Readonly<Record<string, string>>

export type HtmlTopicRead = {
  /** Tokenizer-ready text content. Whitespace collapsed; entities decoded. */
  bodyText: string
  /** Flat list of every typed `<bv-*>` element, in document order. */
  elements: readonly ElementAxisEntry[]
  /** Attributes on the bv-topic root, or empty if no bv-topic was present. */
  topicAttributes: TopicAttributes
}

/**
 * Parse an HTML string into the structured shape the search/index
 * pipeline consumes. The reader is forgiving — malformed HTML returns
 * a best-effort result rather than throwing (parse5 is forgiving by
 * design; we mirror that for the reader's contract).
 */
export function readHtmlTopicSync(html: string): HtmlTopicRead {
  const document = parseHtml(html)
  const allElements = walkElements(document)

  const bodyText = getInnerText(document)

  const elements: ElementAxisEntry[] = []
  let topicAttributes: TopicAttributes = {}

  for (const el of allElements) {
    if (el.tagName === 'bv-topic' && Object.keys(topicAttributes).length === 0) {
      topicAttributes = el.attributes
    }

    if (!isRegisteredElementName(el.tagName)) continue

    elements.push({
      attributes: el.attributes,
      tag: el.tagName,
    })
  }

  return {bodyText, elements, topicAttributes}
}

/**
 * I/O wrapper: reads `filePath` from disk and returns the parsed shape.
 * Used by the search service when indexing HTML topic files.
 */
export async function readHtmlTopic(filePath: string): Promise<HtmlTopicRead> {
  const html = await readFile(filePath, 'utf8')
  return readHtmlTopicSync(html)
}

function isRegisteredElementName(tag: string): tag is ElementName {
  return (ELEMENT_NAMES as readonly string[]).includes(tag)
}
