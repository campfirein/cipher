/**
 * Shared Constants for Coding Agent Hooks
 *
 * Agent-agnostic constants that can be reused across different coding agents
 * (Claude Code, Cursor, Windsurf, etc.).
 */

/** Maximum prompt length to prevent excessive output */
export const MAX_PROMPT_LENGTH = 25_000

/** Maximum log file size before rotation (5MB) */
export const MAX_LOG_SIZE = 5 * 1024 * 1024

/** Default timeout for stdin operations (5 seconds) */
export const STDIN_TIMEOUT_MS = 5000
