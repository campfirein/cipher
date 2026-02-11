/**
 * UI-related types
 */

export type AuthState = 'authorized' | 'checking' | 'unauthorized'

/**
 * Statistics for task states.
 */
export type TaskStats = {
  /** Number of tasks in 'created' status */
  created: number
  /** Number of tasks in 'started' status */
  started: number
}

export type ConsumerStatus = 'error' | 'running' | 'starting' | 'stopped'
