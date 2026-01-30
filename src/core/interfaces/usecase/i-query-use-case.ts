export interface QueryUseCaseRunOptions {
  apiKey?: string
  format?: 'json' | 'text'
  headless?: boolean
  model?: string
  query: string
  verbose?: boolean
}

export interface IQueryUseCase {
  run(options: QueryUseCaseRunOptions): Promise<void>
}
