// Stub: minimal FileQueryLogStore for compilation (ENG-1897).
// Full implementation with Zod validation, atomic writes, and pruning in ENG-1889.

import type {QueryLogEntry} from '../../core/domain/entities/query-log-entry.js'
import type {IQueryLogStore} from '../../core/interfaces/storage/i-query-log-store.js'

export class FileQueryLogStore implements IQueryLogStore {
  readonly baseDir: string

  constructor(opts: {baseDir: string}) {
    this.baseDir = opts.baseDir
  }

  async getById(_id: string): Promise<null | QueryLogEntry> {
    return null // Stub: real implementation in ENG-1889
  }

  async getNextId(): Promise<string> {
    return 'qry-stub' // Stub: real implementation in ENG-1889
  }

  async list(_options?: Parameters<IQueryLogStore['list']>[0]): Promise<QueryLogEntry[]> {
    return [] // Stub: real implementation in ENG-1889
  }

  async save(_entry: QueryLogEntry): Promise<void> {
    // Stub: real implementation in ENG-1889
  }
}
