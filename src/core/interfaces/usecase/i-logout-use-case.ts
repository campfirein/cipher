export interface ILogoutUseCase {
  run: (options: {skipConfirmation: boolean}) => Promise<void>
}