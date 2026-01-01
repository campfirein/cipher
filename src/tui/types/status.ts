/**
 * Status Event Types
 *
 * Types for displaying task status events in the Header's StatusBadge
 */

/**
 * Status event type
 */
export type StatusEventType = 'error' | 'info' | 'success' | 'warning'

/**
 * Status event representing a task completion or failure
 */
export interface StatusEvent {
  /**
   * Time in ms after which the event auto-dismisses
   */
  dismissAfter: number
  /**
   * Unique identifier for the event
   */
  id: string
  /**
   * Label to display in the badge (e.g., "Curate", "Query")
   */
  label: string
  /**
   * Message to display next to the badge
   */
  message: string
  /**
   * Timestamp when the event was created
   */
  timestamp: number
  /**
   * Type of status event
   */
  type: StatusEventType
}

/**
 * Default dismiss times in milliseconds
 */
export const STATUS_DISMISS_TIMES = {
  error: 10_000,
  info: 3000,
  success: 5000,
} as const
