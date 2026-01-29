export interface IPullUseCase {
  run: (options: {branch: string}) => Promise<void>
}
