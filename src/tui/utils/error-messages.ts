/**
 * User-friendly error messages for TUI.
 *
 * Maps task error codes to actionable messages using slash commands
 * (mirrors src/oclif/lib/daemon-client.ts USER_FRIENDLY_MESSAGES for CLI context).
 *
 * Error code values are inlined to avoid importing from server layer.
 */

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  ERR_CONTEXT_TREE_NOT_INIT: 'Context tree not initialized. Run /init first.',
  ERR_LOCAL_CHANGES_EXIST: 'You have local changes. Run /push to save or /reset to discard first.',
  ERR_NOT_AUTHENTICATED: 'Not authenticated. Run /login first.',
  ERR_PROJECT_NOT_INIT: 'Project not initialized. Run /init first.',
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
 * Strips the " for event '...'" suffix that TransportRequestError appends automatically.
 */
export function formatTransportError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const errorRecord = error as unknown as Record<string, unknown>
  const code = 'code' in error && typeof errorRecord.code === 'string' ? errorRecord.code : undefined
  if (code && code in USER_FRIENDLY_MESSAGES) {
    return USER_FRIENDLY_MESSAGES[code]
  }

  return error.message.replace(/ for event '[^']+'$/, '')
}
