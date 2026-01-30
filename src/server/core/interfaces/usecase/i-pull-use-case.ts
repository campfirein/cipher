export interface PullUseCaseRunOptions {
  branch: string
  format?: 'json' | 'text'
}

export interface IPullUseCase {
  run: (options: PullUseCaseRunOptions) => Promise<void>
}
