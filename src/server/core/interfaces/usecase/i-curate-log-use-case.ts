export interface ICurateLogUseCase {
  run(options: {format?: 'json' | 'text'; id?: string; limit?: number}): Promise<void>
}
