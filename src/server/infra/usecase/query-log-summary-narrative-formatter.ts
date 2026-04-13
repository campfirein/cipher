import type {QueryLogSummary} from '../../core/interfaces/usecase/i-query-log-summary-use-case.js'

const NARRATIVE_TOP_DOCS = 2
const NARRATIVE_TOP_GAPS = 2
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

export function formatQueryLogSummaryNarrative(summary: QueryLogSummary): string {
  const periodLabel = describePeriod(summary.period)

  if (summary.totalQueries === 0) {
    return `No queries recorded ${periodLabel}. Your knowledge base is ready — try asking a question!`
  }

  const paragraphs: string[] = []

  paragraphs.push(buildOverviewParagraph(summary, periodLabel))

  if (summary.totalMatchedDocs > 0 && summary.topRecalledDocs.length > 0) {
    paragraphs.push(buildTopDocsParagraph(summary))
  }

  paragraphs.push(buildGapsParagraph(summary))

  return paragraphs.join('\n\n')
}

/**
 * Describe the time period as a human-readable label.
 *
 * Two formats:
 * - 'short': "last 1h", "last 24h", "last 7d" (for text summary header)
 * - 'long': "in the last hour", "in the last 24 hours" (for narrative prose)
 *
 * Only produces a period label when we have a clear relative window
 * (--since/--last without --before). Bounded or ambiguous ranges
 * return empty string (short) or "in the selected period" (long).
 */
export function describePeriod(
  period: QueryLogSummary['period'],
  format: 'long' | 'short' = 'long',
): string {
  if (period.from > 0 && period.to === 0) {
    const spanMs = Date.now() - period.from
    const hours = Math.round(spanMs / MS_PER_HOUR)
    const days = Math.round(spanMs / MS_PER_DAY)

    if (format === 'short') {
      if (hours <= 1) return 'last 1h'
      if (hours <= 25) return 'last 24h'
      return `last ${days}d`
    }

    if (hours <= 1) return 'in the last hour'
    if (hours <= 25) return 'in the last 24 hours'
    return `in the last ${days} days`
  }

  return format === 'short' ? 'selected period' : 'in the selected period'
}

function buildOverviewParagraph(summary: QueryLogSummary, periodLabel: string): string {
  const {byStatus, cacheHitRate, coverageRate, queriesWithoutMatches, responseTime, totalQueries} = summary
  const answered = byStatus.completed - queriesWithoutMatches
  const coveragePct = Math.round(coverageRate * 100)
  const cachePct = Math.round(cacheHitRate * 100)

  return (
    `Your team asked ${totalQueries} questions ${periodLabel}. ` +
    `ByteRover answered ${answered} from curated knowledge ` +
    `(${coveragePct}% coverage), with ${cachePct}% served from cache. ` +
    `Average response time was ${formatDurationMs(responseTime.avgMs)}.`
  )
}

function buildTopDocsParagraph(summary: QueryLogSummary): string {
  const topDocs = summary.topRecalledDocs.slice(0, NARRATIVE_TOP_DOCS)
  const docsList = topDocs.map((doc) => `${doc.path} (${doc.count} queries)`).join(', ')

  return `Most useful knowledge: ${docsList}.`
}

function buildGapsParagraph(summary: QueryLogSummary): string {
  if (summary.knowledgeGaps.length === 0) {
    return 'Every question was answered from curated knowledge.'
  }

  const unansweredCount = summary.queriesWithoutMatches
  const topGaps = summary.knowledgeGaps.slice(0, NARRATIVE_TOP_GAPS)
  const gapsList = topGaps.map((gap) => `"${gap.topic}"`).join(' and ')

  return (
    `${unansweredCount} question${unansweredCount === 1 ? '' : 's'} couldn't be answered — ` +
    `consider curating more about ${gapsList}.`
  )
}

export function formatDurationMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`
  }

  return `${Math.round(ms)}ms`
}
