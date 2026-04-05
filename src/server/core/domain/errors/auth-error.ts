export class AuthenticationError extends Error {
  public readonly code?: string

  public constructor(message: string, code?: string) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
  }
}
