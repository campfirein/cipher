/**
 * ChatGPT OAuth (Codex) API base URL — single source of truth.
 * Used by the agent's OpenAI provider module and the server's provider config resolver.
 */
export const CHATGPT_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * Originator header/param value sent to OpenAI in OAuth flows.
 */
export const CHATGPT_OAUTH_ORIGINATOR = 'byterover'
