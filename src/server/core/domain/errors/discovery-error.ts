/**
 * Base error for OIDC discovery failures.
 */
export class DiscoveryError extends Error {
  public readonly attemptCount?: number
  public readonly issuerUrl: string

  public constructor(message: string, issuerUrl: string, attemptCount?: number) {
    super(message)
    this.name = 'DiscoveryError'
    this.issuerUrl = issuerUrl
    this.attemptCount = attemptCount
  }
}

/**
 * Error thrown when discovery request times out.
 */
export class DiscoveryTimeoutError extends DiscoveryError {
  public constructor(issuerUrl: string, timeoutMs: number, attemptCount?: number) {
    super(`OIDC discovery timed out after ${timeoutMs}ms for issuer: ${issuerUrl}`, issuerUrl, attemptCount)
    this.name = 'DiscoveryTimeoutError'
  }
}

/**
 * Error thrown when discovery encounters a network error.
 */
export class DiscoveryNetworkError extends DiscoveryError {
  public readonly originalError?: Error

  public constructor(issuerUrl: string, originalError?: Error, attemptCount?: number) {
    super(
      `Network error during OIDC discovery for issuer: ${issuerUrl}${
        originalError ? `: ${originalError.message}` : ''
      }`,
      issuerUrl,
      attemptCount,
    )
    this.name = 'DiscoveryNetworkError'
    this.originalError = originalError
  }
}
