export interface InitUseCaseRunOptions {
  force: boolean
  format?: 'json' | 'text'
  /** Space ID for headless mode (skips interactive selection) */
  spaceId?: string
  /** Team ID for headless mode (skips interactive selection) */
  teamId?: string
}

export interface IInitUseCase {
  run(options: InitUseCaseRunOptions): Promise<void>
}
