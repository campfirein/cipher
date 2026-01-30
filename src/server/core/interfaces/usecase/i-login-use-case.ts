export interface LoginUseCaseRunOptions {
  apiKey?: string
}

export interface ILoginUseCase {
  run(options: LoginUseCaseRunOptions): Promise<void>
}
