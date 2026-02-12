export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  detach?: boolean
  files?: string[]
  /** Folder references to pack and analyze (triggers folder pack flow) */
  folders?: string[]
  format?: 'json' | 'text'
  model?: string
  verbose?: boolean
}

export interface ICurateUseCase {
  run(options: CurateUseCaseRunOptions): Promise<void>
}
