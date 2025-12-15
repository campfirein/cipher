export interface IStatusUseCase {
  run(options: {cliVersion: string}): Promise<void>
}
