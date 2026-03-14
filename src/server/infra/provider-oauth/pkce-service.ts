import crypto from 'node:crypto'

import type {PkceParameters} from './types.js'

/**
 * Generates a cryptographically secure PKCE code verifier.
 * Output is 43 characters (base64url encoding of 32 random bytes).
 * Meets the OAuth 2.0 PKCE spec requirement of 43-128 characters.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Generates S256 code challenge from a code verifier.
 * SHA-256 hash of the verifier, base64url-encoded.
 */
export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
}

/**
 * Generates a cryptographically secure state parameter for CSRF protection.
 * Output is 22 characters (base64url encoding of 16 random bytes).
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url')
}

/**
 * Generates a complete set of PKCE parameters for an authorization request.
 * Convenience function combining verifier, challenge, and state generation.
 */
export function generatePkce(): PkceParameters {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()
  return {codeChallenge, codeVerifier, state}
}
