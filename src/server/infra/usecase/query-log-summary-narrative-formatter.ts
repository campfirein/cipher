import type {QueryLogSummary} from '../../core/interfaces/usecase/i-query-log-summary-use-case.js'

const EMPTY_STATE_MESSAGE =
  'No queries recorded in the last 24 hours. Your knowledge base is ready — try asking a question!'

const NARRATIVE_TOP_DOCS = 2
const NARRATIVE_TOP_GAPS = 2

/**
 * Format a QueryLogSummary as a human-readable value story.
 *
 * Pure formatting — no computation. Consumes the data already computed
 * by QueryLogSummaryUseCase (ENG-1898) and wraps it in prose aimed at
 * conveying ByteRover recall value to end users.
 */
export function formatQueryLogSummaryNarrative(summary: QueryLogSummary): string {
  if (summary.totalQueries === 0) {
    return EMPTY_STATE_MESSAGE
  }

  const paragraphs: string[] = []

  paragraphs.push(buildOverviewParagraph(summary))

  if (summary.totalMatchedDocs > 0 && summary.topRecalledDocs.length > 0) {
    paragraphs.push(buildTopDocsParagraph(summary))
  }

  paragraphs.push(buildGapsParagraph(summary))

  return paragraphs.join('\n\n')
}

function buildOverviewParagraph(summary: QueryLogSummary): string {
  const {cacheHitRate, coverageRate, queriesWithoutMatches, responseTime, totalQueries} = summary
  const answered = totalQueries - queriesWithoutMatches
  const coveragePct = Math.round(coverageRate * 100)
  const cachePct = Math.round(cacheHitRate * 100)

  return (
    `Your team asked ${totalQueries} questions today. ` +
    `ByteRover answered ${answered} from curated knowledge ` +
    `(${coveragePct}% coverage), with ${cachePct}% served from cache. ` +
    `Average response time was ${formatDuration(responseTime.avgMs)}.`
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

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`
  }

  return `${Math.round(ms)}ms`
}
