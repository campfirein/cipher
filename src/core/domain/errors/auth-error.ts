export class AuthenticationError extends Error {
  public readonly code?: string

  public constructor(message: string, code?: string) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
  }
}

export class TokenExpiredError extends Error {
  public constructor(message = 'Token has expired') {
    super(message)
    this.name = 'TokenExpiredError'
  }
}

export class InvalidTokenError extends Error {
  public constructor(message = 'Token is invalid') {
    super(message)
    this.name = 'InvalidTokenError'
  }
}
