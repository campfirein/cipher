/**
 * Summary and archive stub frontmatter parser/writer.
 *
 * Follows the same pattern as MarkdownWriter.parseFrontmatter() using js-yaml.
 */

/* eslint-disable camelcase */

import {dump as yamlDump, load as yamlLoad} from 'js-yaml'

import type {ArchiveStubFrontmatter, CondensationOrder, SummaryFrontmatter, SummaryLevel} from '../../core/domain/knowledge/summary-types.js'

// ---------------------------------------------------------------------------
// Summary frontmatter
// ---------------------------------------------------------------------------

/**
 * Parse summary frontmatter from markdown content.
 * Returns null if no frontmatter found or type !== 'summary'.
 */
export function parseSummaryFrontmatter(content: string): null | SummaryFrontmatter {
  const parsed = parseYamlFrontmatter(content)
  if (!parsed || parsed.type !== 'summary') return null

  const condensationOrder = Number(parsed.condensation_order)
  if (!isValidCondensationOrder(condensationOrder)) return null

  return {
    children_hash: String(parsed.children_hash ?? ''),
    compression_ratio: Number(parsed.compression_ratio ?? 0),
    condensation_order: condensationOrder,
    covers: Array.isArray(parsed.covers) ? (parsed.covers as string[]).map(String) : [],
    covers_token_total: Number(parsed.covers_token_total ?? 0),
    summary_level: (String(parsed.summary_level ?? `d${condensationOrder}`)) as SummaryLevel,
    token_count: Number(parsed.token_count ?? 0),
    type: 'summary',
  }
}

/**
 * Generate markdown content with summary frontmatter.
 */
export function generateSummaryContent(frontmatter: SummaryFrontmatter, body: string): string {
  const fm: Record<string, unknown> = {
    children_hash: frontmatter.children_hash,
    compression_ratio: frontmatter.compression_ratio,
    condensation_order: frontmatter.condensation_order,
    covers: frontmatter.covers,
    covers_token_total: frontmatter.covers_token_total,
    summary_level: frontmatter.summary_level,
    token_count: frontmatter.token_count,
    type: 'summary',
  }

  const yamlContent = yamlDump(fm, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()

  return `---\n${yamlContent}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// Archive stub frontmatter
// ---------------------------------------------------------------------------

/**
 * Parse archive stub frontmatter from markdown content.
 * Returns null if no frontmatter found or type !== 'archive_stub'.
 */
export function parseArchiveStubFrontmatter(content: string): ArchiveStubFrontmatter | null {
  const parsed = parseYamlFrontmatter(content)
  if (!parsed || parsed.type !== 'archive_stub') return null

  return {
    evicted_at: String(parsed.evicted_at ?? ''),
    evicted_importance: Number(parsed.evicted_importance ?? 0),
    original_path: String(parsed.original_path ?? ''),
    original_token_count: Number(parsed.original_token_count ?? 0),
    points_to: String(parsed.points_to ?? ''),
    type: 'archive_stub',
  }
}

/**
 * Generate markdown content with archive stub frontmatter and ghost cue body.
 */
export function generateArchiveStubContent(frontmatter: ArchiveStubFrontmatter, ghostCue: string): string {
  const fm: Record<string, unknown> = {
    evicted_at: frontmatter.evicted_at,
    evicted_importance: frontmatter.evicted_importance,
    original_path: frontmatter.original_path,
    original_token_count: frontmatter.original_token_count,
    points_to: frontmatter.points_to,
    type: 'archive_stub',
  }

  const yamlContent = yamlDump(fm, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()

  return `---\n${yamlContent}\n---\n${ghostCue}`
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseYamlFrontmatter(content: string): null | Record<string, unknown> {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null
  }

  const endIndex = content.indexOf('\n---\n', 4)
  const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
  const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex

  if (actualEnd < 0) {
    return null
  }

  const yamlBlock = content.slice(4, actualEnd)

  try {
    const parsed = yamlLoad(yamlBlock) as null | Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null

    return parsed
  } catch {
    return null
  }
}

function isValidCondensationOrder(value: number): value is CondensationOrder {
  return value === 0 || value === 1 || value === 2 || value === 3
}
