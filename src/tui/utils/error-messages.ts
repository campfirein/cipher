/**
 * User-friendly error messages for TUI.
 *
 * Maps task error codes to actionable messages using slash commands
 * (mirrors src/oclif/lib/daemon-client.ts USER_FRIENDLY_MESSAGES for CLI context).
 *
 * Error code values are inlined to avoid importing from server layer.
 */

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  ERR_AGENT_NOT_INITIALIZED: "Agent failed to initialize. Run 'brv restart' to force a clean restart.",
  ERR_CONTEXT_TREE_NOT_INIT: 'Context tree not initialized.',
  ERR_LOCAL_CHANGES_EXIST: 'You have local changes. Run /push to save your changes before pulling.',
  ERR_NOT_AUTHENTICATED: 'Not authenticated. This is required for cloud sync. Run /login to connect your account.',
  ERR_PROJECT_NOT_INIT: "Project not initialized. Run 'brv restart' to reinitialize.",
  ERR_PROVIDER_NOT_CONFIGURED: 'No provider connected. Run /providers connect byterover to use the free built-in provider, or connect another provider.',
  ERR_SPACE_NOT_CONFIGURED: 'No space configured. Run /space switch to select a space first.',
  ERR_SPACE_NOT_FOUND: 'Space not found. Check your configuration.',
}

/**
 * Format a task error (from task:error events) into a user-friendly message.
 * Falls back to the raw error message if no mapping exists.
 */
export function formatTaskError(error: undefined | {code?: string; message: string}): string {
  if (!error) return ''
  if (error.code && error.code in USER_FRIENDLY_MESSAGES) {
    return USER_FRIENDLY_MESSAGES[error.code]
  }

  return error.message
}

/**
 * Format a transport error (from request/response calls) into a user-friendly message.
 * Checks for a `code` property on the error and looks up a friendly message.
 */
export function formatTransportError(error: Error): string {
  const code = 'code' in error ? (error as {code?: string}).code : undefined
  if (code && code in USER_FRIENDLY_MESSAGES) {
    return USER_FRIENDLY_MESSAGES[code]
  }

  return error.message
}
