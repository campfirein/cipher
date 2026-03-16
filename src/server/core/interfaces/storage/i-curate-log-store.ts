import type {CurateLogEntry} from '../../domain/entities/curate-log-entry.js'

export type CurateLogStatus = 'cancelled' | 'completed' | 'error' | 'processing'

export interface ICurateLogStore {
  /** Batch-update reviewStatus for multiple operations within a single log entry. Reads once, writes once. */
  batchUpdateOperationReviewStatus(
    logId: string,
    updates: Array<{operationIndex: number; reviewStatus: 'approved' | 'rejected'}>,
  ): Promise<boolean>
  /** Retrieve an entry by ID. Returns null if not found or if the file is corrupt. */
  getById(id: string): Promise<CurateLogEntry | null>
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
    status?: CurateLogStatus[]
  }): Promise<CurateLogEntry[]>
  /** Persist (create or overwrite) a log entry. Best-effort — callers should handle errors. */
  save(entry: CurateLogEntry): Promise<void>
}
