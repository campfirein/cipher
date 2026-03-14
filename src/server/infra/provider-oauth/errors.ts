export class ProviderOAuthError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ProviderOAuthError'
  }
}

export class ProviderCallbackTimeoutError extends ProviderOAuthError {
  public readonly timeoutMs: number

  public constructor(timeoutMs: number) {
    super(`OAuth callback timed out after ${timeoutMs}ms`)
    this.name = 'ProviderCallbackTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export class ProviderCallbackStateError extends ProviderOAuthError {
  public constructor() {
    super('OAuth callback state mismatch — possible CSRF attack')
    this.name = 'ProviderCallbackStateError'
  }
}

export class ProviderCallbackOAuthError extends ProviderOAuthError {
  public readonly errorCode: string

  public constructor(errorCode: string, errorDescription?: string) {
    super(errorDescription ?? `OAuth provider returned error: ${errorCode}`)
    this.name = 'ProviderCallbackOAuthError'
    this.errorCode = errorCode
  }
}

export class ProviderTokenExchangeError extends ProviderOAuthError {
  public readonly errorCode?: string
  public readonly statusCode?: number

  public constructor(params: {errorCode?: string; message: string; statusCode?: number}) {
    super(params.message)
    this.name = 'ProviderTokenExchangeError'
    this.errorCode = params.errorCode
    this.statusCode = params.statusCode
  }
}
