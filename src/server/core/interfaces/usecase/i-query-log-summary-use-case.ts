import type {ByTier} from '../../domain/entities/query-log-entry.js'

export type QueryLogSummary = {
  byStatus: {
    cancelled: number
    completed: number
    error: number
  }
  byTier: ByTier
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
