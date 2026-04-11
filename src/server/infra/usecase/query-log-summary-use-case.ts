import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {IQueryLogStore} from '../../core/interfaces/storage/i-query-log-store.js'
import type {
  IQueryLogSummaryUseCase,
  QueryLogSummary,
  QueryLogSummaryFormat,
} from '../../core/interfaces/usecase/i-query-log-summary-use-case.js'

import {formatQueryLogSummaryNarrative} from './query-log-summary-narrative-formatter.js'

type QueryLogSummaryUseCaseDeps = {
  queryLogStore: IQueryLogStore
  terminal: ITerminal
}

const EMPTY_TEXT_OUTPUT = 'Query Recall Summary\n(no entries yet)'

export class QueryLogSummaryUseCase implements IQueryLogSummaryUseCase {
  constructor(private readonly deps: QueryLogSummaryUseCaseDeps) {}

  async run(options: {after?: number; before?: number; format?: QueryLogSummaryFormat}): Promise<void> {
    // TODO(ENG-1898): replace makeZeroSummary() with real aggregation from this.deps.queryLogStore
    const summary = makeZeroSummary()
    const format = options.format ?? 'text'

    if (format === 'narrative') {
      this.deps.terminal.log(formatQueryLogSummaryNarrative(summary))
      return
    }

    if (format === 'json') {
      this.deps.terminal.log(JSON.stringify(summary, null, 2))
      return
    }

    this.deps.terminal.log(EMPTY_TEXT_OUTPUT)
  }
}

function makeZeroSummary(): QueryLogSummary {
  return {
    byStatus: {cancelled: 0, completed: 0, error: 0},
    byTier: {tier0: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unknown: 0},
    cacheHitRate: 0,
    coverageRate: 0,
    knowledgeGaps: [],
    period: {from: 0, to: 0},
    queriesWithoutMatches: 0,
    responseTime: {avgMs: 0, p50Ms: 0, p95Ms: 0},
    topRecalledDocs: [],
    topTopics: [],
    totalMatchedDocs: 0,
    totalQueries: 0,
  }
}
