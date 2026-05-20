/**
 * Context-tree index generator.
 *
 * Deterministic, no-LLM. Walks `.brv/context-tree/`, aggregates the
 * topic metadata the agent already authored (`title`, `summary`,
 * `tags`), groups topics by domain, and writes the `<bv-index>`
 * navigation document to `_index.html` at the context-tree root.
 *
 * Full regeneration on every call — the index is a pure function of the
 * current tree, so a full rebuild is trivially correct. For trees up to
 * a few hundred topics the walk is sub-second; an incremental
 * (manifest-delta) path is the optimization to reach for only if
 * profiling shows the walk is slow.
 *
 * Output is deterministic except for the `generatedat` timestamp:
 * domains and entries are sorted, so an unchanged tree produces a
 * byte-stable index (clean diffs in CoGit-tracked trees).
 */

import {readdir, readFile} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

import {INDEX_HTML_FILE} from '../../constants.js'
import {DirectoryManager} from '../../core/domain/knowledge/directory-manager.js'
import {MarkdownWriter} from '../../core/domain/knowledge/markdown-writer.js'
import {validateHtmlIndex} from '../render/index-elements/index.js'
import {escapeHtmlAttributeValue} from '../render/writer/html-writer.js'
import {isDerivedArtifact} from './derived-artifact.js'

/** Legacy archive directory inside the context tree — its topics are excluded. */
const ARCHIVED_DIR = '_archived'

/** Domain bucket for topics that sit at the context-tree root with no domain segment. */
const UNCATEGORIZED_DOMAIN = 'general'

/** Matches the opening `<bv-topic ...>` tag — cheap metadata extraction without a full parse. */
const BV_TOPIC_RE = /<bv-topic\b([^>]*)>/i

type TopicEntry = {
  format: 'html' | 'markdown'
  /** Relative path under the context-tree root, forward-slash normalized. */
  path: string
  summary: string
  tags: string
  title: string
}

export type GenerateIndexResult =
  | {domainCount: number; ok: true; topicCount: number; written: string}
  | {error: string; ok: false}

/**
 * Walk the context tree, build the `<bv-index>` document, and write it
 * atomically to `_index.html`. Pure filesystem — no daemon, no LLM.
 */
export async function generateContextTreeIndex(input: {
  contextTreeRoot: string
  projectName: string
}): Promise<GenerateIndexResult> {
  const {contextTreeRoot, projectName} = input

  let files: string[]
  try {
    files = []
    await walkTopicFiles(contextTreeRoot, contextTreeRoot, files)
  } catch (error) {
    return {error: `index walk failed: ${String(error)}`, ok: false}
  }

  const entries: TopicEntry[] = []
  for (const absolutePath of files) {
    const relPath = relative(contextTreeRoot, absolutePath).replaceAll(sep, '/')
    // eslint-disable-next-line no-await-in-loop
    const entry = await readTopicEntry(absolutePath, relPath)
    if (entry) entries.push(entry)
  }

  const html = renderIndex(projectName, entries)

  // Self-check: the generator controls its output, but a generator bug
  // should surface loudly here rather than write a malformed _index.html.
  const validation = validateHtmlIndex(html)
  if (!validation.ok) {
    const messages = validation.errors.map((e) => e.message).join('; ')
    return {error: `generated index failed self-validation: ${messages}`, ok: false}
  }

  const indexPath = join(contextTreeRoot, INDEX_HTML_FILE)
  try {
    await DirectoryManager.writeFileAtomic(indexPath, html)
  } catch (error) {
    return {error: `index write failed: ${String(error)}`, ok: false}
  }

  const domainCount = new Set(entries.map((e) => domainOf(e.path))).size
  return {domainCount, ok: true, topicCount: entries.length, written: indexPath}
}

/**
 * Best-effort index regeneration for post-write hooks (curate, dream
 * finalize). The triggering operation has already succeeded; a failed
 * index refresh must never propagate. Failures are logged and swallowed
 * — `brv index rebuild` recovers a stale index.
 */
export async function regenerateContextTreeIndex(input: {
  contextTreeRoot: string
  log: (msg: string) => void
  projectName: string
}): Promise<void> {
  try {
    const result = await generateContextTreeIndex({
      contextTreeRoot: input.contextTreeRoot,
      projectName: input.projectName,
    })
    if (!result.ok) input.log(`context-tree index regeneration failed: ${result.error}`)
  } catch (error) {
    input.log(`context-tree index regeneration threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Tree walk ─────────────────────────────────────────────────────────

async function walkTopicFiles(rootDir: string, current: string, accumulator: string[]): Promise<void> {
  let dirEntries
  try {
    dirEntries = await readdir(current, {withFileTypes: true})
  } catch {
    return
  }

  const subwalks: Array<Promise<void>> = []
  for (const dirEntry of dirEntries) {
    // Skip dot-dirs (.git, …) and the legacy `_archived/` subtree —
    // archived topics must not appear in the navigation index.
    if (dirEntry.name.startsWith('.') || dirEntry.name === ARCHIVED_DIR) continue
    const next = join(current, dirEntry.name)
    if (dirEntry.isDirectory()) {
      subwalks.push(walkTopicFiles(rootDir, next, accumulator))
      continue
    }

    if (dirEntry.isFile() && (dirEntry.name.endsWith('.html') || dirEntry.name.endsWith('.md'))) {
      accumulator.push(next)
    }
  }

  await Promise.all(subwalks)
}

// ── Per-topic metadata extraction ─────────────────────────────────────

async function readTopicEntry(absolutePath: string, relPath: string): Promise<TopicEntry | undefined> {
  // Derived artifacts (_index.html, _index.md, _manifest.json, …) are
  // navigation/summary files, not topics — never index them.
  if (isDerivedArtifact(relPath)) return undefined

  let content: string
  try {
    content = await readFile(absolutePath, 'utf8')
  } catch {
    return undefined
  }

  if (!content.trim()) return undefined

  return relPath.toLowerCase().endsWith('.html')
    ? readHtmlEntry(content, relPath)
    : readMarkdownEntry(content, relPath)
}

/** Extract entry metadata from an HTML topic's `<bv-topic>` opening tag. */
function readHtmlEntry(content: string, relPath: string): TopicEntry | undefined {
  const match = BV_TOPIC_RE.exec(content)
  if (!match) return undefined

  const attrs = parseTagAttributes(match[1] ?? '')
  const title = attrs.title?.trim()
  if (!title) return undefined

  return {
    format: 'html',
    path: relPath,
    summary: attrs.summary?.trim() ?? '',
    tags: attrs.tags?.trim() ?? '',
    title,
  }
}

/** Extract entry metadata from a legacy Markdown topic's frontmatter. */
function readMarkdownEntry(content: string, relPath: string): TopicEntry | undefined {
  let parsed
  try {
    parsed = MarkdownWriter.parseContent(content, relPath)
  } catch {
    return undefined
  }

  const title = parsed.name?.trim()
  if (!title) return undefined

  return {
    format: 'markdown',
    path: relPath,
    summary: parsed.summary?.trim() ?? '',
    tags: parsed.tags.join(','),
    title,
  }
}

/**
 * Parse attributes out of an opening tag's inner text. Accepts double-
 * and single-quoted values; attribute names are lowercased to match
 * HTML5 parsing semantics.
 */
function parseTagAttributes(rawAttrs: string): Record<string, string> {
  const result: Record<string, string> = {}
  const attrRe = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: null | RegExpExecArray
  while ((match = attrRe.exec(rawAttrs)) !== null) {
    const name = match[1]?.toLowerCase()
    const value = match[2] ?? match[3]
    if (name && value !== undefined) result[name] = value
  }

  return result
}

// ── Rendering ─────────────────────────────────────────────────────────

/** First path segment, or the uncategorized bucket for root-level topics. */
function domainOf(relPath: string): string {
  const slash = relPath.indexOf('/')
  return slash > 0 ? relPath.slice(0, slash) : UNCATEGORIZED_DOMAIN
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function renderIndex(projectName: string, entries: readonly TopicEntry[]): string {
  // Group by domain.
  const byDomain = new Map<string, TopicEntry[]>()
  for (const entry of entries) {
    const domain = domainOf(entry.path)
    const bucket = byDomain.get(domain)
    if (bucket) bucket.push(entry)
    else byDomain.set(domain, [entry])
  }

  const domains = [...byDomain.keys()].sort((a, b) => a.localeCompare(b))
  const generatedAt = new Date().toISOString()

  const lines: string[] = []
  lines.push(
    `<bv-index project="${escapeHtmlAttributeValue(projectName)}" generatedat="${generatedAt}"` +
      ` topiccount="${entries.length}" domaincount="${domains.length}">`,
  )

  for (const domain of domains) {
    const domainEntries = (byDomain.get(domain) ?? []).sort((a, b) => a.path.localeCompare(b.path))
    lines.push(
      `  <bv-index-domain name="${escapeHtmlAttributeValue(domain)}" count="${domainEntries.length}">`,
    )
    for (const entry of domainEntries) {
      const tagsAttr = entry.tags ? ` tags="${escapeHtmlAttributeValue(entry.tags)}"` : ''
      lines.push(
        `    <bv-index-entry path="${escapeHtmlAttributeValue(entry.path)}"` +
          ` title="${escapeHtmlAttributeValue(entry.title)}" format="${entry.format}"${tagsAttr}>` +
          escapeHtmlText(entry.summary) +
          `</bv-index-entry>`,
      )
    }

    lines.push('  </bv-index-domain>')
  }

  lines.push('</bv-index>')
  return lines.join('\n') + '\n'
}
