export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  files?: string[]
  format?: 'json' | 'text'
  headless?: boolean
  model?: string
  verbose?: boolean
}

export interface ICurateUseCase {
  run(options: CurateUseCaseRunOptions): Promise<void>
}
