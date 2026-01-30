export interface IStatusUseCase {
  run(options: {cliVersion: string; format?: 'json' | 'text'}): Promise<void>
}
