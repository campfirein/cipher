export interface IInitUseCase {
  run(options: {force: boolean}): Promise<void>
}
