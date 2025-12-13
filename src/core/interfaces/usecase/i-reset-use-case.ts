export interface IResetUseCase {
  run(options: {directory?: string; skipConfirmation: boolean;}): Promise<void>
}
