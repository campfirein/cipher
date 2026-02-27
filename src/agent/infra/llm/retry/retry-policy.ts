/**
 * Retry Policy Configuration.
 *
 * Defines retry behavior for LLM operations with exponential backoff.
 * Based on patterns from gemini-cli for consistent retry handling.
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryPolicy {
  /** Multiplier for exponential backoff (e.g., 2 = double delay each time) */
  backoffMultiplier: number
  /** Base delay in milliseconds before first retry */
  baseDelayMs: number
  /** Jitter factor (0-1) to randomize delays and prevent thundering herd */
  jitterFactor: number
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number
  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number
  /** Error types/messages that should trigger a retry */
  retryableErrors: string[]
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[]
}

/**
 * Default retry policy with sensible defaults.
 *
 * - 3 retry attempts
 * - Starting at 1 second, max 30 seconds
 * - 2x exponential backoff
 * - 25% jitter
 * - Retries on common transient errors (429, 500, 502, 503, 504)
 * - Retries on empty/incomplete LLM responses (transient API issues)
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 1000,
  jitterFactor: 0.25,
  maxDelayMs: 30_000,
  maxRetries: 3,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'rate_limit',
    'rate limit',
    'overloaded',
    'capacity',
    'timeout',
    'temporarily unavailable',
    // LLM empty/incomplete response errors (transient API issues)
    'neither content nor tool calls',
    'no content',
    'empty response',
    'no messages',
  ],
  retryableStatusCodes: [429, 500, 502, 503, 504],
}

/**
 * Aggressive retry policy for critical operations.
 *
 * More retries with longer delays for operations that must succeed.
 */
export const AGGRESSIVE_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 2000,
  jitterFactor: 0.3,
  maxDelayMs: 60_000,
  maxRetries: 5,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'rate_limit',
    'overloaded',
    'capacity',
    'timeout',
    'temporarily unavailable',
    // LLM empty/incomplete response errors (transient API issues)
    'neither content nor tool calls',
    'no content',
    'empty response',
    'no messages',
  ],
  retryableStatusCodes: [429, 500, 502, 503, 504],
}

/**
 * Minimal retry policy for fast-fail scenarios.
 *
 * Single retry with short delay when quick feedback is preferred.
 */
export const MINIMAL_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 500,
  jitterFactor: 0.1,
  maxDelayMs: 2000,
  maxRetries: 1,
  retryableErrors: ['rate_limit', 'overloaded'],
  retryableStatusCodes: [429, 503],
}

/**
 * No retry policy - fail immediately on any error.
 */
export const NO_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 1,
  baseDelayMs: 0,
  jitterFactor: 0,
  maxDelayMs: 0,
  maxRetries: 0,
  retryableErrors: [],
  retryableStatusCodes: [],
}

/**
 * Create a custom retry policy by merging with defaults.
 *
 * @param overrides - Partial policy to override defaults
 * @returns Complete retry policy
 */
export function createRetryPolicy(overrides: Partial<RetryPolicy>): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    ...overrides,
  }
}

/**
 * Check if an error should be retried based on the policy.
 *
 * @param error - The error to check
 * @param policy - The retry policy to use
 * @returns True if the error is retryable
 */
export function isRetryableError(error: unknown, policy: RetryPolicy): boolean {
  // Check if we have any retry configuration
  if (policy.maxRetries === 0) {
    return false
  }

  // Handle HTTP-like errors with status codes
  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>

    // Check status code
    const status = errorObj.status ?? errorObj.statusCode ?? errorObj.code
    if (typeof status === 'number' && policy.retryableStatusCodes.includes(status)) {
      return true
    }

    // Check for gRPC status codes (common transient errors)
    const grpcCode = errorObj.code
    // gRPC codes: 14 = UNAVAILABLE, 8 = RESOURCE_EXHAUSTED, 4 = DEADLINE_EXCEEDED
    if (typeof grpcCode === 'number' && [4, 8, 14].includes(grpcCode)) {
      return true
    }
  }

  // Check error message against retryable patterns
  const errorMessage = error instanceof Error ? error.message : String(error)
  const lowerMessage = errorMessage.toLowerCase()

  return policy.retryableErrors.some((pattern) => lowerMessage.includes(pattern.toLowerCase()))
}

/**
 * Calculate delay for a specific retry attempt with exponential backoff and jitter.
 *
 * @param attempt - Current retry attempt (1-based)
 * @param policy - The retry policy to use
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  // Calculate base exponential delay
  const exponentialDelay = policy.baseDelayMs * policy.backoffMultiplier ** (attempt - 1)

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs)

  // Apply jitter (randomize within jitter factor range)
  const jitterRange = cappedDelay * policy.jitterFactor
  const jitter = Math.random() * jitterRange * 2 - jitterRange

  // Ensure delay is at least 0
  return Math.max(0, Math.round(cappedDelay + jitter))
}

// ─── Rate Limit Delay Extraction ────────────────────────────────────────────
//
// When providers return HTTP 429, they embed retry timing in different ways:
//   - Anthropic, OpenAI, Groq, xAI, Mistral: standard `retry-after` header (seconds)
//   - OpenAI Azure: `retry-after-ms` header (milliseconds)
//   - Anthropic backup: `anthropic-ratelimit-*-reset` header (RFC 3339 timestamp)
//   - OpenRouter: `X-RateLimit-Reset` header (Unix timestamp in milliseconds)
//   - OpenAI/Groq fallback: `x-ratelimit-reset-tokens` header (Go duration, e.g. "6m0s")
//   - Gemini: NO headers — uses `retryDelay` inside `google.rpc.RetryInfo` in the body
//
// This fallback is used when a 429 fires but no header parsing yields a result:
export const RATE_LIMIT_FALLBACK_DELAY_MS = 65_000

/**
 * Normalize raw headers object to lowercase keys for case-insensitive lookup.
 * Providers like OpenRouter use capitalized header names (e.g. "X-RateLimit-Reset").
 */
function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key.toLowerCase()] = value
    }
  }

  return result
}

/**
 * Parse a Go duration string (used by OpenAI and Groq) into milliseconds.
 *
 * Examples: "6m0s" → 360000, "2m59.56s" → 179560, "120ms" → 120, "1s" → 1000
 *
 * Key subtlety: must parse "ms" before "m" to avoid matching the "m" inside "ms"
 * as minutes. Uses negative lookahead on "m" to prevent this.
 */
function parseGoDuration(duration: string): number | undefined {
  let totalMs = 0
  let matched = false

  // Minutes: "6m", "2m" — use negative lookahead so "m" in "ms" doesn't match
  const minuteMatch = /(\d+(?:\.\d+)?)m(?!s)/.exec(duration)
  if (minuteMatch) {
    totalMs += Number.parseFloat(minuteMatch[1]) * 60 * 1000
    matched = true
  }

  // Milliseconds: "120ms", "17ms" — must check before seconds since "ms" ends with "s"
  const msMatch = /(\d+(?:\.\d+)?)ms/.exec(duration)
  if (msMatch) {
    totalMs += Math.ceil(Number.parseFloat(msMatch[1]))
    matched = true
  } else {
    // Seconds (only when no "ms" match): "0s", "1s", "59.56s", "7.66s"
    const secMatch = /(\d+(?:\.\d+)?)s/.exec(duration)
    if (secMatch) {
      totalMs += Math.ceil(Number.parseFloat(secMatch[1]) * 1000)
      matched = true
    }
  }

  return matched ? totalMs : undefined
}

/**
 * Extract Gemini's retry delay from the `google.rpc.RetryInfo` details in the body.
 *
 * Gemini 429 body shape:
 * { error: { details: [{ "@type": "...RetryInfo", "retryDelay": "53s" }] } }
 *
 * The `retryDelay` is a duration string like "53s" or "1.5s".
 */
function extractGeminiRetryDelay(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  const error = b['error'] as Record<string, unknown> | undefined
  const details = error?.['details'] as Array<Record<string, unknown>> | undefined

  if (!Array.isArray(details)) return undefined

  for (const detail of details) {
    const type = detail['@type']
    if (typeof type === 'string' && type.includes('RetryInfo')) {
      const retryDelay = detail['retryDelay']
      if (typeof retryDelay === 'string') {
        const match = /^(\d+(?:\.\d+)?)s$/.exec(retryDelay)
        if (match) {
          return Math.ceil(Number.parseFloat(match[1]) * 1000) + 2000
        }
      }
    }
  }

  return undefined
}

/**
 * Try to parse Gemini retry delay from a raw JSON string body.
 */
function parseGeminiBodyString(body: unknown): number | undefined {
  if (typeof body !== 'string') return undefined
  try {
    return extractGeminiRetryDelay(JSON.parse(body) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Extract the correct retry delay from an AI provider 429 error.
 *
 * Tries all known provider patterns in priority order and returns the
 * delay in milliseconds (including a +2s buffer), or undefined if none found.
 *
 * Caller should fall back to RATE_LIMIT_FALLBACK_DELAY_MS when this returns undefined.
 *
 * @param error - The caught error (expected to be AI_APICallError from Vercel AI SDK)
 * @returns Delay in milliseconds, or undefined
 */
export function extractRateLimitDelay(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as Record<string, unknown>

  const headers = normalizeHeaders(e['responseHeaders'])

  if (headers) {
    // ── Path 1: Standard retry-after header ──────────────────────────────────
    // Anthropic, OpenAI, Groq, xAI, Mistral all use this (integer seconds).
    const retryAfter = headers['retry-after']
    if (retryAfter !== undefined) {
      const seconds = Number.parseInt(retryAfter, 10)
      if (!Number.isNaN(seconds) && seconds >= 0) {
        return (seconds + 2) * 1000 // +2s buffer
      }

      // Fallback: some CDN proxies return an HTTP-date string instead of seconds
      const dateMs = new Date(retryAfter).getTime()
      if (!Number.isNaN(dateMs)) {
        const delay = dateMs - Date.now()
        if (delay > 0) return delay + 2000
      }
    }

    // ── Path 2: retry-after-ms (Azure OpenAI, millisecond precision) ─────────
    const retryAfterMs = headers['retry-after-ms']
    if (retryAfterMs !== undefined) {
      const ms = Number.parseFloat(retryAfterMs)
      if (!Number.isNaN(ms) && ms > 0) {
        return Math.ceil(ms) + 2000
      }
    }

    // ── Path 3: Anthropic reset timestamp backup ──────────────────────────────
    // anthropic-ratelimit-input-tokens-reset (RFC 3339). retry-after should
    // always be present for Anthropic, but this handles edge cases.
    const anthropicReset =
      headers['anthropic-ratelimit-input-tokens-reset'] ??
      headers['anthropic-ratelimit-tokens-reset']
    if (anthropicReset !== undefined) {
      const resetMs = new Date(anthropicReset).getTime() - Date.now()
      if (resetMs > 0) return resetMs + 2000
    }

    // ── Path 4: OpenRouter X-RateLimit-Reset (Unix timestamp in milliseconds) ─
    // OpenRouter is unique: it uses a Unix ms timestamp, not a duration string.
    // Heuristic: any numeric value > 1e12 is a Unix ms timestamp (year ≥ 2001).
    const openrouterReset = headers['x-ratelimit-reset']
    if (openrouterReset !== undefined) {
      const value = Number.parseInt(openrouterReset, 10)
      if (!Number.isNaN(value) && value > 1_000_000_000_000) {
        const delay = value - Date.now()
        if (delay > 0) return delay + 2000
      }
    }

    // ── Path 5: OpenAI/Groq Go-duration reset headers (fallback) ─────────────
    // x-ratelimit-reset-tokens / x-ratelimit-reset-requests: "6m0s", "17ms"
    // Only reached if retry-after is absent (shouldn't happen for these providers,
    // but acts as a safety net).
    const goReset =
      headers['x-ratelimit-reset-tokens'] ??
      headers['x-ratelimit-reset-requests']
    if (goReset !== undefined) {
      const durationMs = parseGoDuration(goReset)
      if (durationMs !== undefined && durationMs > 0) {
        return durationMs + 2000
      }
    }
  }

  // ── Path 6: Gemini retryDelay in response body (no headers on Gemini) ──────
  // Gemini embeds timing in google.rpc.RetryInfo inside the JSON body.
  // Try e.data first (AI SDK may pre-parse the body), then e.responseBody (raw string).
  const geminiDelay =
    extractGeminiRetryDelay(e['data']) ??
    parseGeminiBodyString(e['responseBody'])

  if (geminiDelay !== undefined) return geminiDelay

  return undefined
}
