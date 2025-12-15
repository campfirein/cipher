export interface IClearUseCase {
  run(options: {directory?: string; skipConfirmation: boolean}): Promise<void>
}
