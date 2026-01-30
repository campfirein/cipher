export interface PushUseCaseRunOptions {
  branch: string
  format?: 'json' | 'text'
  skipConfirmation: boolean
}

export interface IPushUseCase {
  run(options: PushUseCaseRunOptions): Promise<void>
}
