import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'

import {ExperienceStore} from '../../../../server/infra/context-tree/experience-store.js'

export interface PerformanceTrendContributorOptions {
  maxEntries?: number
  workingDirectory?: string
}

/**
 * Performance trend contributor that provides recent task performance data.
 *
 * Reads the performance-log.jsonl file and computes per-domain rolling
 * averages to inject into the system prompt. Only active for curate/query.
 */
export class PerformanceTrendContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly maxEntries: number
  private readonly store: ExperienceStore

  public constructor(id: string, priority: number, options: PerformanceTrendContributorOptions = {}) {
    this.id = id
    this.priority = priority
    this.maxEntries = options.maxEntries ?? 10
    this.store = new ExperienceStore(options.workingDirectory ?? process.cwd())
  }

  public async getContent(context: ContributorContext): Promise<string> {
    // Only inject for curate and query commands
    if (context.commandType !== 'curate' && context.commandType !== 'query') {
      return ''
    }

    const allEntries = await this.store.readPerformanceLog()

    if (allEntries.length < 3) {
      return ''
    }

    // Group by domain, keeping all entries, then truncate per-domain to last N
    const byDomain = new Map<string, number[]>()
    for (const entry of allEntries) {
      const scores = byDomain.get(entry.domain) ?? []
      scores.push(entry.score)
      byDomain.set(entry.domain, scores)
    }

    // Per-domain rolling window: keep only the last maxEntries scores per domain
    for (const [domain, scores] of byDomain) {
      if (scores.length > this.maxEntries) {
        byDomain.set(domain, scores.slice(-this.maxEntries))
      }
    }

    const trendLines: string[] = []
    const sortedDomains = [...byDomain.keys()].sort()

    for (const domain of sortedDomains) {
      const scores = byDomain.get(domain)!
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      const trend = this.detectTrend(scores)
      trendLines.push(`- ${domain}: avg ${avg.toFixed(2)} (${scores.length} tasks), ${trend}`)
    }

    return [
      '<performance-trends>',
      '## Recent Performance',
      ...trendLines,
      '</performance-trends>',
    ].join('\n')
  }

  private detectTrend(scores: number[]): string {
    if (scores.length < 4) {
      return 'stable'
    }

    const mid = Math.floor(scores.length / 2)
    const firstHalf = scores.slice(0, mid)
    const secondHalf = scores.slice(mid)

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
    const diff = avgSecond - avgFirst

    if (diff > 0.05) return 'trending up'
    if (diff < -0.05) return 'trending down'

    return 'stable'
  }
}
