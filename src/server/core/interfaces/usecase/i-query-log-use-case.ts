// Interface driven by brv query-log view command (ENG-1897).
// Full implementation in ENG-1895.

import type {QueryLogStatus, QueryLogTier} from '../storage/i-query-log-store.js'

export interface IQueryLogUseCase {
  run(options: {
    after?: number
    before?: number
    detail?: boolean
    format?: 'json' | 'text'
    id?: string
    limit?: number
    status?: QueryLogStatus[]
    tier?: QueryLogTier[]
  }): Promise<void>
}
