import {useEffect, useState} from 'react'

import type {QueueSnapshot, QueueStats} from '../consumer/queue-polling-service.js'
import type {Execution, ToolCall} from '../storage/agent-storage.js'

import {getQueuePollingService, stopQueuePollingService} from '../consumer/queue-polling-service.js'

/**
 * React hook for subscribing to QueuePollingService events
 *
 * Architecture:
 * - Connects to singleton QueuePollingService
 * - Updates React state only when data changes
 * - Cleans up on unmount
 * - Prevents memory leaks via singleton pattern
 *
 * Usage in Ink component:
 * ```tsx
 * const { stats, runningExecutions, recentExecutions, error } = useQueuePolling()
 * ```
 */
export function useQueuePolling(options?: {pollInterval?: number}): {
  error: Error | null
  isConnected: boolean
  recentExecutions: Execution[]
  runningExecutions: Array<{execution: Execution; toolCalls: ToolCall[]}>
  stats: null | QueueStats
} {
  const [stats, setStats] = useState<null | QueueStats>(null)
  const [runningExecutions, setRunningExecutions] = useState<Array<{execution: Execution; toolCalls: ToolCall[]}>>([])
  const [recentExecutions, setRecentExecutions] = useState<Execution[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const service = getQueuePollingService({pollInterval: options?.pollInterval})

    // Subscribe to events
    const handleSnapshot = (snapshot: QueueSnapshot): void => {
      setStats(snapshot.stats)
      setRunningExecutions(snapshot.runningExecutions)
      setRecentExecutions(snapshot.recentExecutions)
      setIsConnected(true)
    }

    const handleError = (err: Error): void => {
      setError(err)
    }

    const handleStopped = (): void => {
      setIsConnected(false)
    }

    service.on('snapshot', handleSnapshot)
    service.on('error', handleError)
    service.on('stopped', handleStopped)

    // Start service if not running
    if (service.isRunning()) {
      // Get current snapshot immediately
      const current = service.getCurrentSnapshot()
      if (current) {
        handleSnapshot(current)
      }
    } else {
      service.start().catch((error_) => {
        setError(error_ instanceof Error ? error_ : new Error(String(error_)))
      })
    }

    // Cleanup on unmount
    return () => {
      service.off('snapshot', handleSnapshot)
      service.off('error', handleError)
      service.off('stopped', handleStopped)
      // Note: Don't stop service here - other components may be using it
      // Service is stopped via stopQueuePollingService() when app exits
    }
  }, [options?.pollInterval])

  return {
    error,
    isConnected,
    recentExecutions,
    runningExecutions,
    stats,
  }
}

/**
 * Cleanup hook - call when dashboard unmounts
 */
export function useQueuePollingCleanup(): () => void {
  return () => {
    stopQueuePollingService()
  }
}
