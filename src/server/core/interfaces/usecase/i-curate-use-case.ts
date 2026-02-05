export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  files?: string[]
  /** Folder references to pack and analyze (triggers folder pack flow) */
  folders?: string[]
  format?: 'json' | 'text'
  headless?: boolean
  model?: string
  verbose?: boolean
}

export interface ICurateUseCase {
  run(options: CurateUseCaseRunOptions): Promise<void>
}
