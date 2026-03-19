/**
 * ChatGPT OAuth (Codex) API base URL — single source of truth.
 * Used by the agent's OpenAI provider module and the server's provider config resolver.
 */
export const CHATGPT_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * Originator header/param value sent to OpenAI in OAuth flows.
 */
export const CHATGPT_OAUTH_ORIGINATOR = 'byterover'

/**
 * OAuth callback timeout in milliseconds (5 minutes).
 * Used by the callback server, TUI await-oauth-callback mutation, and CLI connect command.
 */
export const OAUTH_CALLBACK_TIMEOUT_MS = 300_000
