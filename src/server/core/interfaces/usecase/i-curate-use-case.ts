export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  files?: string[]
  model?: string
  verbose?: boolean
}

export interface ICurateUseCase {
  run(options: CurateUseCaseRunOptions): Promise<void>
}
