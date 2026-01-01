/**
 * Session Metadata Types and Schemas
 *
 * Defines the data structures for persistent session management.
 * Sessions are stored in .brv/sessions/ directory as JSON files.
 *
 * Design adapted from gemini-cli's ChatRecordingService pattern.
 */

import {z} from 'zod'

/**
 * Session status indicating lifecycle state.
 */
export type SessionStatus = 'active' | 'ended' | 'interrupted'

/**
 * Active session pointer stored in .brv/sessions/active.json
 * Points to the currently active session for auto-resume.
 */
export interface ActiveSessionPointer {
  /** ISO timestamp when this session became active */
  activatedAt: string

  /** PID of the process that activated this session (for stale detection) */
  pid: number

  /** Session ID of the currently active session */
  sessionId: string
}

/**
 * Session metadata stored in .brv/sessions/session-*.json
 * Contains metadata about a session for listing and management.
 */
export interface SessionMetadata {
  /** ISO timestamp when session was created */
  createdAt: string

  /** ISO timestamp of last activity */
  lastUpdated: string

  /** Number of messages in session (cached for quick display) */
  messageCount: number

  /** Unique session identifier (UUID) */
  sessionId: string

  /** Session lifecycle status */
  status: SessionStatus

  /** Optional AI-generated summary */
  summary?: string

  /** Session title (generated from first user message) */
  title?: string

  /** Project working directory (for validation) */
  workingDirectory: string
}

/**
 * Session info for display purposes (extends metadata with computed fields).
 */
export interface SessionInfo extends SessionMetadata {
  /** Filename without extension */
  file: string

  /** Full filename including .json extension */
  fileName: string

  /** First user message content (cleaned) */
  firstUserMessage?: string

  /** Display index in the list (1-based) */
  index: number

  /** Whether this is the currently active session */
  isCurrentSession: boolean
}

/**
 * Result of resolving a session selection.
 */
export interface SessionSelectionResult {
  /** Display info string for user feedback */
  displayInfo: string

  /** Loaded session metadata */
  sessionData: SessionMetadata

  /** Full path to session metadata file */
  sessionPath: string
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Schema for ActiveSessionPointer validation.
 */
export const ActiveSessionPointerSchema = z.object({
  activatedAt: z.string().datetime({offset: true}).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
})

/**
 * Schema for SessionMetadata validation.
 */
export const SessionMetadataSchema = z.object({
  createdAt: z.string().datetime({offset: true}).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  lastUpdated: z.string().datetime({offset: true}).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  messageCount: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  status: z.enum(['active', 'ended', 'interrupted']),
  summary: z.string().optional(),
  title: z.string().optional(),
  workingDirectory: z.string().min(1),
})

// ============================================================================
// Constants
// ============================================================================

/** Prefix for session metadata files */
export const SESSION_FILE_PREFIX = 'session-'

/** Directory name for session storage */
export const SESSIONS_DIR = 'sessions'

/** Filename for active session pointer */
export const ACTIVE_SESSION_FILE = 'active.json'

/** Default session retention config */
export const DEFAULT_SESSION_RETENTION = {
  /** Maximum age in days before auto-cleanup */
  maxAgeDays: 30,
  /** Maximum number of sessions to keep */
  maxCount: 50,
  /** Run cleanup on startup */
  runOnStartup: true,
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a session filename from timestamp and session ID.
 *
 * @param sessionId - The session UUID
 * @returns Filename in format: session-YYYY-MM-DDTHH-MM-SS-<uuid-prefix>.json
 */
export function generateSessionFilename(sessionId: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  const uuidPrefix = sessionId.slice(0, 8)
  return `${SESSION_FILE_PREFIX}${timestamp}-${uuidPrefix}.json`
}

/**
 * Parse a session filename to extract timestamp and UUID prefix.
 *
 * @param filename - The session filename
 * @returns Parsed components or null if invalid format
 */
export function parseSessionFilename(filename: string): null | {timestamp: string; uuidPrefix: string} {
  if (!filename.startsWith(SESSION_FILE_PREFIX) || !filename.endsWith('.json')) {
    return null
  }

  // Remove prefix and .json suffix
  const withoutPrefix = filename.slice(SESSION_FILE_PREFIX.length, -5)

  // Format: YYYY-MM-DDTHH-MM-SS-<uuid-prefix>
  // The UUID prefix is the last 8 characters after the last dash
  const lastDashIndex = withoutPrefix.lastIndexOf('-')
  if (lastDashIndex === -1) {
    return null
  }

  const timestamp = withoutPrefix.slice(0, lastDashIndex)
  const uuidPrefix = withoutPrefix.slice(lastDashIndex + 1)

  if (uuidPrefix.length !== 8) {
    return null
  }

  return {timestamp, uuidPrefix}
}

/**
 * Format a timestamp as relative time.
 *
 * @param timestamp - ISO timestamp string
 * @param style - 'long' (e.g., "2 hours ago") or 'short' (e.g., "2h")
 * @returns Formatted relative time string
 */
export function formatRelativeTime(timestamp: string, style: 'long' | 'short' = 'long'): string {
  const now = new Date()
  const time = new Date(timestamp)
  const diffMs = now.getTime() - time.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (style === 'short') {
    if (diffSeconds < 1) return 'now'
    if (diffSeconds < 60) return `${diffSeconds}s`
    if (diffMinutes < 60) return `${diffMinutes}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 30) return `${diffDays}d`
    const diffMonths = Math.floor(diffDays / 30)
    return diffMonths < 12 ? `${diffMonths}mo` : `${Math.floor(diffMonths / 12)}y`
  }

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }

  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }

  return 'Just now'
}

/**
 * Clean and sanitize message content for display.
 * Converts newlines to spaces, collapses whitespace, removes non-printable chars.
 *
 * @param message - Raw message content
 * @returns Cleaned message suitable for display
 */
export function cleanMessageForTitle(message: string): string {
  return message
    .replaceAll(/\n+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[^\u0020-\u007E]+/g, '') // Remove non-printable ASCII
    .trim()
    .slice(0, 100) // Limit length for title
}
