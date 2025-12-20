export interface QueryUseCaseRunOptions {
  apiKey?: string
  model?: string
  query: string
  verbose?: boolean
}

export interface IQueryUseCase {
  run(options: QueryUseCaseRunOptions): Promise<void>
}
