import chalk from 'chalk'

import type {SwarmQueryResult} from '../../../core/interfaces/i-swarm-coordinator.js'

/**
 * Format swarm query results for terminal display.
 */
export function formatQueryResults(result: SwarmQueryResult, query: string): string {
  const lines: string[] = [
    chalk.bold(`\nSwarm Query: "${query}"`),
    `Type: ${chalk.cyan(result.meta.queryType)} | Latency: ${chalk.yellow(`${result.meta.totalLatencyMs}ms`)}`,
  ]

  // Provider summary
  const providerEntries = Object.entries(result.meta.providers)
  if (providerEntries.length > 0) {
    const providerSummary = providerEntries
      .map(([id, meta]) => `${id} (${meta.resultCount} results, ${meta.latencyMs}ms)`)
      .join(', ')
    lines.push(`Providers: ${providerSummary}`)
  }

  lines.push('─'.repeat(50))

  if (result.results.length === 0) {
    lines.push(chalk.dim('No results found.'))

    return lines.join('\n')
  }

  for (const [i, r] of result.results.entries()) {
    const scoreStr = chalk.green(r.score.toFixed(2))
    const sourceStr = chalk.dim(r.metadata.source)
    const matchStr = chalk.dim(`[${r.metadata.matchType}]`)

    // Truncate content to 200 chars for display
    const content = r.content.length > 200 ? `${r.content.slice(0, 200)}…` : r.content
    lines.push(
      `${chalk.bold(`${i + 1}.`)} ${sourceStr} ${matchStr} score: ${scoreStr}`,
      `   ${content}`,
      '',
    )
  }

  if (result.meta.costCents > 0) {
    lines.push(chalk.dim(`Cost: $${(result.meta.costCents / 100).toFixed(4)}`))
  }

  return lines.join('\n')
}

/**
 * Format swarm query results as JSON.
 */
export function formatQueryResultsJson(result: SwarmQueryResult): string {
  return JSON.stringify(result, undefined, 2)
}
