// Interface driven by `brv query-log summary` command (ENG-1899).
// Full implementation of data computation, text format, and JSON format in ENG-1898.

export type QueryLogSummary = {
  byStatus: {
    cancelled: number
    completed: number
    error: number
  }
  byTier: {
    tier0: number
    tier1: number
    tier2: number
    tier3: number
    tier4: number
    unknown: number
  }
  cacheHitRate: number
  coverageRate: number
  knowledgeGaps: {
    count: number
    exampleQueries: string[]
    topic: string
  }[]
  period: {from: number; to: number}
  queriesWithoutMatches: number
  responseTime: {
    avgMs: number
    p50Ms: number
    p95Ms: number
  }
  topRecalledDocs: {
    count: number
    path: string
  }[]
  topTopics: {
    count: number
    topic: string
  }[]
  totalMatchedDocs: number
  totalQueries: number
}

export type QueryLogSummaryFormat = 'json' | 'narrative' | 'text'

export interface IQueryLogSummaryUseCase {
  run(options: {
    after?: number
    before?: number
    format?: QueryLogSummaryFormat
  }): Promise<void>
}
