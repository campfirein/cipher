import axios, {isAxiosError} from 'axios'

import {DiscoveryError, DiscoveryNetworkError, DiscoveryTimeoutError} from '../../core/domain/errors/discovery-error.js'
import {IOidcDiscoveryService, OidcMetadata} from '../../core/interfaces/i-oidc-discovery-service.js'

/**
 * Response from the OIDC discovery endpoint.
 */
type OidcDiscoveryResponse = {
  authorization_endpoint: string
  issuer: string
  scopes_supported?: string[]
  token_endpoint: string
}

/**
 * Cache entry for OIDC metadata.
 */
type CacheEntry = {
  expiresAt: number
  metadata: OidcMetadata
}

/**
 * OIDC discovery service implementation.
 * Fetches OIDC configuration from the well-known endpoint with in-memory caching.
 */
export class OidcDiscoveryService implements IOidcDiscoveryService {
  private readonly cache: Map<string, CacheEntry> = new Map()
  private readonly cacheTtlMs: number
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly timeoutMs: number

  /**
   * Creates a new OIDC discovery service.
   * @param cacheTtlMs Cache TTL in milliseconds (default: 1 hour)
   * @param timeoutMs Request timeout in milliseconds (default: 5 seconds)
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param retryDelayMs Base delay between retries in milliseconds (default: 1 second)
   */
  public constructor(
    cacheTtlMs: number = 3_600_000,
    timeoutMs: number = 5000,
    maxRetries: number = 3,
    retryDelayMs: number = 1000,
  ) {
    this.cacheTtlMs = cacheTtlMs
    this.maxRetries = maxRetries
    this.retryDelayMs = retryDelayMs
    this.timeoutMs = timeoutMs
  }

  public async discover(issuerUrl: string): Promise<OidcMetadata> {
    // Check cache first
    const cached = this.getFromCache(issuerUrl)
    if (cached) {
      return cached
    }

    // Fetch from discovery endpoint
    const metadata = await this.fetchMetadata(issuerUrl)

    // Store in cache
    this.storeInCache(issuerUrl, metadata)

    return metadata
  }

  /**
   * Fetches OIDC metadata from the well-known endpoint with retry logic.
   * @param issuerUrl The base URL of the OIDC issuer.
   * @returns The OIDC metadata.
   */
  private async fetchMetadata(issuerUrl: string): Promise<OidcMetadata> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await this.fetchMetadataOnce(issuerUrl, attempt)
      } catch (error) {
        lastError = error as Error

        // Don't retry on non-retryable errors
        if (error instanceof DiscoveryError && !(error instanceof DiscoveryNetworkError)) {
          throw error
        }

        // Don't retry if this was the last attempt
        if (attempt >= this.maxRetries) {
          break
        }

        // Wait before retrying (exponential backoff)
        const delay = this.retryDelayMs * 2 ** (attempt - 1)
        // eslint-disable-next-line no-await-in-loop
        await this.sleep(delay)
      }
    }

    // All retries exhausted
    throw new DiscoveryError(
      `Failed to discover OIDC configuration after ${this.maxRetries} attempts: ${lastError?.message}`,
      issuerUrl,
      this.maxRetries,
    )
  }

  /**
   * Fetches OIDC metadata from the well-known endpoint (single attempt).
   * @param issuerUrl The base URL of the OIDC issuer.
   * @param attempt Current attempt number.
   * @returns The OIDC metadata.
   */
  private async fetchMetadataOnce(issuerUrl: string, attempt: number): Promise<OidcMetadata> {
    try {
      const wellKnownUrl = `${issuerUrl}/.well-known/openid-configuration`
      const response = await axios.get<OidcDiscoveryResponse>(wellKnownUrl, {
        timeout: this.timeoutMs,
      })

      // Validate required fields
      if (!response.data.authorization_endpoint || !response.data.token_endpoint) {
        throw new DiscoveryError('Invalid OIDC discovery document: missing required endpoints', issuerUrl, attempt)
      }

      return {
        authorizationEndpoint: response.data.authorization_endpoint,
        issuer: response.data.issuer,
        scopesSupported: response.data.scopes_supported,
        tokenEndpoint: response.data.token_endpoint,
      }
    } catch (error) {
      if (isAxiosError(error)) {
        // Timeout error
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new DiscoveryTimeoutError(issuerUrl, this.timeoutMs, attempt)
        }

        // Network errors (retryable)
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || !error.response) {
          throw new DiscoveryNetworkError(issuerUrl, error, attempt)
        }

        // HTTP errors (non-retryable)
        throw new DiscoveryError(
          `HTTP ${error.response?.status}: ${error.response?.statusText || error.message}`,
          issuerUrl,
          attempt,
        )
      }

      throw error
    }
  }

  /**
   * Gets metadata from cache if available and not expired.
   * @param issuerUrl The issuer URL.
   * @returns The cached metadata or undefined.
   */
  private getFromCache(issuerUrl: string): OidcMetadata | undefined {
    const entry = this.cache.get(issuerUrl)
    if (!entry) {
      return undefined
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(issuerUrl)
      return undefined
    }

    return entry.metadata
  }

  /**
   * Sleep for a specified duration.
   * @param ms Milliseconds to sleep.
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Stores metadata in cache.
   * @param issuerUrl The issuer URL.
   * @param metadata The metadata to cache.
   */
  private storeInCache(issuerUrl: string, metadata: OidcMetadata): void {
    this.cache.set(issuerUrl, {
      expiresAt: Date.now() + this.cacheTtlMs,
      metadata,
    })
  }
}
