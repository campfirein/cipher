/**
 * Detects if the current process is running in a sandboxed environment
 * (e.g., Cursor AI agent, VSCode extension, Claude Code, Codex, etc.)
 *
 * Sandboxed environments typically have restricted network access and
 * may set specific environment variables or have characteristic error patterns.
 */
export function isSandboxEnvironment(): boolean {
  // Check for IDE-specific environment variables
  const {env} = process

  // Cursor IDE
  if (env.CURSOR_AGENT || env.CURSOR_SESSION_ID) {
    return true
  }

  // VS Code / GitHub Copilot
  if (env.VSCODE_INJECTION || env.VSCODE_PID || env.VSCODE_IPC_HOOK) {
    return true
  }

  // Claude Code
  if (env.CLAUDE_AGENT || env.CLAUDE_SESSION) {
    return true
  }

  // Codex
  if (env.CODEX_AGENT || env.CODEX_SESSION) {
    return true
  }

  // Windsurf
  if (env.WINDSURF_AGENT || env.WINDSURF_SESSION) {
    return true
  }

  // Check for common sandbox indicators
  // Sandboxed terminals often have restricted stdin/stdout
  if (!process.stdin.isTTY && !process.stdout.isTTY) {
    // This alone isn't enough, but combined with error patterns it helps
    // We'll rely more on error message patterns for detection
  }

  return false
}

/**
 * Detects if an error is specifically a sandbox network restriction error.
 *
 * Sandbox network errors have characteristic patterns:
 * - WebSocket connection failures with "network" or "websocket error"
 * - XHR poll errors (Socket.IO fallback blocked)
 * - Connection refused errors that occur immediately (sandbox blocks before connection)
 *
 * This is more specific than general network errors which might be:
 * - Actual network connectivity issues
 * - Firewall blocks
 * - Server not running
 * - CORS origin errors (though with CORS origin = '*', this shouldn't happen)
 *
 * Note: With CORS origin configured as '*', CORS errors are impossible.
 * When connection fails in sandbox, it's almost certainly due to network permission,
 * not origin restrictions.
 */
export function isSandboxNetworkError(error: Error | string): boolean {
  const errorMessage = typeof error === 'string' ? error : error.message
  const lowerMessage = errorMessage.toLowerCase()

  // First, check if it's a CORS/origin error (unlikely with origin = '*', but check anyway)
  const isCorsError =
    lowerMessage.includes('cors') ||
    lowerMessage.includes('origin') ||
    (lowerMessage.includes('forbidden') && lowerMessage.includes('origin'))

  // If it's a CORS error, it's NOT a sandbox network permission error
  // (though with origin = '*', CORS errors shouldn't occur)
  if (isCorsError) {
    return false
  }

  // Specific sandbox network permission error patterns
  const sandboxPatterns = [
    // WebSocket errors that indicate sandbox blocking
    'websocket error',
    'xhr poll error',
    // Network errors that occur immediately (sandbox blocks before connection)
    'network',
    // Connection refused that happens immediately (sandbox blocks)
    'econnrefused',
  ]

  // Check if error matches sandbox patterns
  const matchesSandboxPattern = sandboxPatterns.some((pattern) => lowerMessage.includes(pattern))

  // Additional check: if it's a connection error but instance is likely running
  // (we can't know for sure, but sandbox errors are usually immediate failures)
  const isConnectionError = lowerMessage.includes('connection') || lowerMessage.includes('connect')

  // Only consider it a sandbox network permission error if:
  // 1. Matches sandbox patterns AND
  // 2. Is a connection-related error AND
  // 3. We're in a sandbox environment (or error pattern strongly suggests it)
  // 4. NOT a CORS error (already checked above)
  if (matchesSandboxPattern && isConnectionError) {
    // Prefer environment detection, but if error pattern is very specific, trust it
    if (isSandboxEnvironment()) {
      return true
    }

    // Very specific sandbox error patterns that we can trust even without env detection
    if (lowerMessage.includes('websocket error') || lowerMessage.includes('xhr poll error')) {
      return true
    }
  }

  return false
}

/**
 * Gets a user-friendly description of the detected sandbox environment.
 */
export function getSandboxEnvironmentName(): string {
  const {env} = process

  if (env.CURSOR_AGENT || env.CURSOR_SESSION_ID) {
    return 'Cursor'
  }

  if (env.VSCODE_INJECTION || env.VSCODE_PID || env.VSCODE_IPC_HOOK) {
    return 'VS Code / GitHub Copilot'
  }

  if (env.CLAUDE_AGENT || env.CLAUDE_SESSION) {
    return 'Claude Code'
  }

  if (env.CODEX_AGENT || env.CODEX_SESSION) {
    return 'Codex'
  }

  if (env.WINDSURF_AGENT || env.WINDSURF_SESSION) {
    return 'Windsurf'
  }

  return 'IDE sandbox'
}
