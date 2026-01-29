export interface IPushUseCase {
  run(options: {branch: string; skipConfirmation: boolean}): Promise<void>
}
