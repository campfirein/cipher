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
  ERR_OAUTH_REFRESH_FAILED: 'OAuth token refresh failed. Run /providers to reconnect your provider.',
  ERR_OAUTH_TOKEN_EXPIRED: 'OAuth token has expired. Run /providers to reconnect your provider.',
  ERR_PROJECT_NOT_INIT: "Project not initialized. Run 'brv restart' to reinitialize.",
  ERR_PROVIDER_NOT_CONFIGURED:
    'No provider connected. Run /providers connect byterover to use the free built-in provider, or connect another provider.',
  ERR_SPACE_NOT_CONFIGURED: 'No space configured. Run /space switch to select a space first.',
  ERR_SPACE_NOT_FOUND: 'Space not found. Check your configuration.',
  ERR_VC_AUTH_FAILED: 'Authentication failed. Run /login.',
  ERR_VC_BRANCH_ALREADY_EXISTS: 'Branch already exists.',
  ERR_VC_CANNOT_DELETE_CURRENT_BRANCH: 'Cannot delete the currently checked-out branch.',
  ERR_VC_CONFIG_KEY_NOT_SET: 'Config key is not set.',
  ERR_VC_GIT_NOT_INITIALIZED: 'ByteRover version control not initialized. Run /vc init first.',
  ERR_VC_INVALID_ACTION: 'Invalid action.',
  ERR_VC_INVALID_BRANCH_NAME: 'Invalid branch name.',
  ERR_VC_INVALID_CONFIG_KEY: 'Invalid config key. Allowed: user.name, user.email.',
  ERR_VC_NO_COMMITS: 'No commits yet. Run /vc add and /vc commit first.',
  ERR_VC_NO_REMOTE: 'No remote configured. Run /vc remote add origin <url>.',
  ERR_VC_NON_FAST_FORWARD: 'Remote has changes. Run /vc pull first.',
  ERR_VC_NOTHING_STAGED: 'Nothing staged. Run /vc add first.',
  ERR_VC_NOTHING_TO_PUSH: 'No commits to push. Run /vc add and /vc commit first.',
  ERR_VC_PUSH_FAILED: 'Push failed. Check your connection and try again.',
  ERR_VC_REMOTE_ALREADY_EXISTS: "Remote 'origin' already exists. Use /vc remote set-url <url> to update.",
  ERR_VC_UNCOMMITTED_CHANGES: 'You have uncommitted changes. Commit or use --force to discard.',
  // ERR_VC_USER_NOT_CONFIGURED intentionally omitted: fall through to server's specific hint with actual values
}

/**
 * Format a task error (from task:error events) into a user-friendly message.
 * Falls back to the raw error message if no mapping exists.
 */
export function formatTaskError(error?: {code?: string; message: string}): string {
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

  if (error.name === 'TransportRequestTimeoutError') {
    return 'Request timed out. Please try again.'
  }

  return error.message.replace(/ for event '[^']+'(?: after \d+ms)?$/, '')
}
