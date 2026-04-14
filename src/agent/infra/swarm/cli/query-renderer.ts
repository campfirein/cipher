import chalk from 'chalk'

import type {ProviderType} from '../../../core/domain/swarm/types.js'
import type {SwarmQueryResult} from '../../../core/interfaces/i-swarm-coordinator.js'

const DISPLAY_CONTENT_LIMIT = 2000

export function providerTypeToLabel(type: ProviderType, id: string): string {
  switch (type) {
    case 'byterover': { return 'context-tree'
    }

    case 'gbrain': { return 'gbrain'
    }

    case 'hindsight': { return 'hindsight'
    }

    case 'honcho': { return 'honcho'
    }

    case 'local-markdown': {
      const name = id.split(':')[1] ?? 'files'
      return `notes:${name}`
    }

    case 'memory-wiki': { return 'wiki'
    }

    case 'obsidian': { return 'obsidian'
    }
  }
}

const LABEL_COLORS: Record<ProviderType, (s: string) => string> = {
  byterover: chalk.cyan,
  gbrain: chalk.yellow,
  hindsight: chalk.blueBright,
  honcho: chalk.blue,
  'local-markdown': chalk.green,
  'memory-wiki': chalk.whiteBright,
  obsidian: chalk.magenta,
}

function colorLabel(providerType: ProviderType, provider: string): string {
  const label = providerTypeToLabel(providerType, provider)
  const colorFn = LABEL_COLORS[providerType]
  return colorFn(`[${label}]`)
}

/**
 * Format swarm query results for terminal display.
 */
export function formatQueryResults(result: SwarmQueryResult, query: string): string {
  const providerEntries = Object.entries(result.meta.providers)
  const queriedCount = providerEntries.filter(([, meta]) => meta.selected !== false).length
  const lines: string[] = [
    chalk.bold(`\nSwarm Query: "${query}"`),
    `Type: ${chalk.cyan(result.meta.queryType)} | Providers: ${chalk.yellow(`${queriedCount} queried`)} | Latency: ${chalk.yellow(`${result.meta.totalLatencyMs}ms`)}`,
    '─'.repeat(50),
  ]

  if (result.results.length === 0) {
    lines.push(chalk.dim('No results found.'))

    return lines.join('\n')
  }

  for (const [i, r] of result.results.entries()) {
    const scoreStr = chalk.green(r.score.toFixed(4))
    const sourceStr = chalk.dim(r.metadata.source)
    const matchStr = chalk.dim(`[${r.metadata.matchType}]`)
    const label = r.providerType ? colorLabel(r.providerType, r.provider) : ''

    const content = r.content.length > DISPLAY_CONTENT_LIMIT ? `${r.content.slice(0, DISPLAY_CONTENT_LIMIT)}…` : r.content
    lines.push(
      `${chalk.bold(`${i + 1}.`)} ${label} ${sourceStr}    score: ${scoreStr}  ${matchStr}`,
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
 * Format swarm query results with detailed explain output.
 */
export function formatQueryResultsExplain(result: SwarmQueryResult, query: string): string {
  const providerEntries = Object.entries(result.meta.providers)
  const selected = providerEntries.filter(([, m]) => m.selected !== false)
  const excluded = providerEntries.filter(([, m]) => m.selected === false)
  const lines: string[] = [
    chalk.bold(`\nSwarm Query: "${query}"`),
    `Classification: ${chalk.cyan(result.meta.queryType)}`,
    `Provider selection: ${selected.length} of ${providerEntries.length} available`,
  ]
  for (const [id, meta] of selected) {
    lines.push(`  ${chalk.green('✓')} ${id}    (healthy, selected, ${meta.resultCount} results, ${meta.latencyMs}ms)`)
  }

  for (const [id, meta] of excluded) {
    lines.push(`  ${chalk.red('✗')} ${id}    (excluded — ${meta.excludeReason ?? 'unknown'})`)
  }

  // Enrichment
  const enriched = providerEntries.filter(([, m]) => m.enrichedBy)
  if (enriched.length > 0) {
    lines.push('Enrichment:')
    for (const [id, meta] of enriched) {
      const excerpts = meta.enrichmentExcerpts?.length
        ? ` (context: ${meta.enrichmentExcerpts.map((k) => `"${k.slice(0, 30)}"`).join(', ')})`
        : ''
      lines.push(`  ${meta.enrichedBy} → ${id}${excerpts}`)
    }
  }

  // Result count
  const totalRaw = providerEntries.reduce((sum, [, m]) => sum + m.resultCount, 0)
  lines.push(
    `Results: ${totalRaw} raw → ${result.results.length} after RRF fusion + precision filtering`,
    '─'.repeat(50),
  )

  if (result.results.length === 0) {
    lines.push(chalk.dim('No results found.'))

    return lines.join('\n')
  }

  for (const [i, r] of result.results.entries()) {
    const scoreStr = chalk.green(r.score.toFixed(4))
    const sourceStr = chalk.dim(r.metadata.source)
    const matchStr = chalk.dim(`[${r.metadata.matchType}]`)
    const label = r.providerType ? colorLabel(r.providerType, r.provider) : ''

    const content = r.content.length > DISPLAY_CONTENT_LIMIT ? `${r.content.slice(0, DISPLAY_CONTENT_LIMIT)}…` : r.content
    lines.push(
      `${chalk.bold(`${i + 1}.`)} ${label} ${sourceStr}    score: ${scoreStr}  ${matchStr}`,
      `   ${content}`,
      '',
    )
  }

  if (result.meta.costCents > 0) {
    lines.push(chalk.dim(`Cost: $${(result.meta.costCents / 100).toFixed(4)}`))
  }

  lines.push(`Latency: ${result.meta.totalLatencyMs}ms`)

  return lines.join('\n')
}

/**
 * Format swarm query results as JSON.
 */
export function formatQueryResultsJson(result: SwarmQueryResult): string {
  return JSON.stringify(result, undefined, 2)
}
