// Stub: minimal QueryLogUseCase for compilation (ENG-1897).
// Full implementation with list/detail views in ENG-1896.

import type {IQueryLogUseCase} from '../../core/interfaces/usecase/i-query-log-use-case.js'

type Terminal = {log(msg?: string): void}

type QueryLogUseCaseDeps = {
  queryLogStore: unknown
  terminal: Terminal
}

export class QueryLogUseCase implements IQueryLogUseCase {
  constructor(private readonly deps: QueryLogUseCaseDeps) {}

  async run(_options: Parameters<IQueryLogUseCase['run']>[0]): Promise<void> {
    // Stub: real implementation in ENG-1896
  }
}
