import type {CurateLogStatus} from '../storage/i-curate-log-store.js'

export interface ICurateLogUseCase {
  run(options: {
    after?: number
    before?: number
    detail?: boolean
    format?: 'json' | 'text'
    id?: string
    limit?: number
    status?: CurateLogStatus[]
  }): Promise<void>
}
