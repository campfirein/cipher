/**
 * JWT Utilities for Provider OAuth
 *
 * Parses provider-specific claims from OAuth id_tokens.
 * Uses manual base64url decoding — no external JWT library needed.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extracts the ChatGPT Account ID from an OpenAI id_token.
 *
 * Checks claims in priority order:
 * 1. `chatgpt_account_id` (top-level claim)
 * 2. `["https://api.openai.com/auth"].chatgpt_account_id` (nested claim)
 * 3. `organizations[0].id` (fallback)
 *
 * @returns The account ID string, or undefined if not found or token is malformed
 */
export function parseAccountIdFromIdToken(idToken: string): string | undefined {
  try {
    const parts = idToken.split('.')
    if (parts.length < 2 || !parts[1]) return undefined

    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!isRecord(payload)) return undefined

    // 1. Top-level claim
    if (typeof payload.chatgpt_account_id === 'string' && payload.chatgpt_account_id) {
      return payload.chatgpt_account_id
    }

    // 2. Nested claim under OpenAI auth namespace
    const authNamespace = payload['https://api.openai.com/auth']
    if (
      isRecord(authNamespace) &&
      typeof authNamespace.chatgpt_account_id === 'string' &&
      authNamespace.chatgpt_account_id
    ) {
      return authNamespace.chatgpt_account_id
    }

    // 3. Organizations fallback
    if (Array.isArray(payload.organizations) && payload.organizations.length > 0) {
      const org: unknown = payload.organizations[0]
      if (isRecord(org) && typeof org.id === 'string' && org.id) {
        return org.id
      }
    }

    return undefined
  } catch {
    return undefined
  }
}
