/**
 * Text formatting for the `brv search` CLI command.
 * Pure function — no oclif, transport, or daemon dependencies.
 */

import type {SearchKnowledgeResult} from '../../agent/infra/sandbox/tools-sdk.js'

/**
 * Format search results for terminal display.
 * Returns an array of lines (without trailing newlines).
 */
export function formatSearchTextOutput(searchResult: SearchKnowledgeResult): string[] {
  const lines: string[] = []

  if (searchResult.totalFound === 0) {
    lines.push('', 'No results found.', '')
    return lines
  }

  const displayed = searchResult.results.length
  const total = searchResult.totalFound
  const countLabel =
    displayed < total ? `Showing ${displayed} of ${total} results` : `Found ${total} result${total === 1 ? '' : 's'}`
  lines.push('', `${countLabel}:`, '')

  for (const [i, result] of searchResult.results.entries()) {
    const scoreStr = (result.score * 100).toFixed(0)
    const excerpt =
      result.excerpt && result.excerpt.length > 120 ? `${result.excerpt.slice(0, 117)}...` : result.excerpt

    lines.push(
      `  ${i + 1}. ${result.title} [${scoreStr}%]`,
      `     Path: ${result.path}`,
      ...(excerpt ? [`     ${excerpt}`] : []),
      ...(result.backlinkCount ? [`     Backlinks: ${result.backlinkCount}`] : []),
      '',
    )
  }

  return lines
}
