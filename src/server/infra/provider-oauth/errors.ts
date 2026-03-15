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

/**
 * Checks whether an OAuth token refresh error is permanent (token revoked, client invalid)
 * vs. transient (network timeout, server error).
 *
 * Permanent errors require disconnecting the provider and re-authenticating.
 * Transient errors should preserve credentials so the existing access token can still be used.
 */
export function isPermanentOAuthError(error: unknown): boolean {
  if (!(error instanceof ProviderTokenExchangeError)) {
    return false
  }

  // 401/403 are unconditionally permanent (credentials rejected)
  if (error.statusCode && [401, 403].includes(error.statusCode)) {
    return true
  }

  // 400 is only permanent when the OAuth error code explicitly indicates it.
  // A 400 with an unknown or transient error code (e.g. temporarily_unavailable)
  // should preserve credentials so the existing access token can still be used.
  const permanentErrorCodes = new Set(['invalid_client', 'invalid_grant', 'unauthorized_client'])
  if (error.errorCode && permanentErrorCodes.has(error.errorCode)) {
    return true
  }

  return false
}
