/**
 * UI-related types
 */

export type AuthState = 'authorized' | 'checking' | 'unauthorized'

export type TabId = 'activity' | 'console'

export interface Tab {
  id: TabId
  label: string
}

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
