export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  files?: string[]
  format?: 'json' | 'text'
  model?: string
  verbose?: boolean
}

export interface ICurateUseCase {
  run(options: CurateUseCaseRunOptions): Promise<void>
}
