import type {CurateLogEntry} from '../../domain/entities/curate-log-entry.js'

export interface ICurateLogStore {
  /** Retrieve an entry by ID. Returns null if not found or if the file is corrupt. */
  getById(id: string): Promise<CurateLogEntry | null>
  /** Generate the next monotonic log entry ID. */
  getNextId(): Promise<string>
  /** List entries sorted newest-first. */
  list(options?: {limit?: number}): Promise<CurateLogEntry[]>
  /** Persist (create or overwrite) a log entry. Best-effort — callers should handle errors. */
  save(entry: CurateLogEntry): Promise<void>
}
