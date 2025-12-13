/**
 * UI-related types
 */

export type AuthState = 'authorized' | 'checking' | 'unauthorized'

export type TabId = 'activity' | 'console'

export interface Tab {
  id: TabId
  label: string
}

export interface QueueStats {
  pending: number
  processing: number
}

export type ConsumerStatus = 'error' | 'running' | 'starting' | 'stopped'
