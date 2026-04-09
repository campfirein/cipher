import type {QueryLogEntry, QueryLogStatus, QueryLogTier} from '../../domain/entities/query-log-entry.js'

// Re-export domain types — single source of truth is in the entity.
export {QUERY_LOG_STATUSES, QUERY_LOG_TIERS} from '../../domain/entities/query-log-entry.js'
export type {QueryLogStatus, QueryLogTier} from '../../domain/entities/query-log-entry.js'

export interface IQueryLogStore {
  /** Retrieve an entry by ID. Returns null if not found or if the file is corrupt. */
  getById(id: string): Promise<null | QueryLogEntry>
  /** Generate the next monotonic log entry ID. */
  getNextId(): Promise<string>
  /** List entries sorted newest-first. Filters are applied before limit. */
  list(options?: {
    /** Include only entries with startedAt >= after (ms timestamp). */
    after?: number
    /** Include only entries with startedAt <= before (ms timestamp). */
    before?: number
    limit?: number
    /** Include only entries matching these statuses. */
    status?: QueryLogStatus[]
    /** Include only entries matching these tiers. */
    tier?: QueryLogTier[]
  }): Promise<QueryLogEntry[]>
  /** Persist (create or overwrite) a log entry. Best-effort — callers should handle errors. */
  save(entry: QueryLogEntry): Promise<void>
}
