import {useEffect, useState} from 'react'

import type {ExecutionWithToolCalls, QueueSnapshot, QueueStats} from '../consumer/queue-polling-service.js'

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
 * const { stats, sessionExecutions, error } = useQueuePolling({ consumerId })
 * ```
 */
export function useQueuePolling(options?: {consumerId?: string; pollInterval?: number}): {
  error: Error | null
  isConnected: boolean
  reconnectCount: number
  sessionExecutions: ExecutionWithToolCalls[]
  stats: null | QueueStats
} {
  const [stats, setStats] = useState<null | QueueStats>(null)
  const [sessionExecutions, setSessionExecutions] = useState<ExecutionWithToolCalls[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)

  useEffect(() => {
    const service = getQueuePollingService({pollInterval: options?.pollInterval})

    // Update consumerId when it changes (e.g., after consumer starts)
    if (options?.consumerId) {
      service.setConsumerId(options.consumerId)
    }

    // Subscribe to events
    const handleSnapshot = (snapshot: QueueSnapshot): void => {
      setStats(snapshot.stats)
      setSessionExecutions(snapshot.sessionExecutions)
      setIsConnected(true)
    }

    const handleError = (err: Error): void => {
      setError(err)
    }

    const handleStopped = (): void => {
      setIsConnected(false)
    }

    const handleReconnected = (): void => {
      // Clear error on successful reconnect
      setError(null)
      setReconnectCount((prev) => prev + 1)
    }

    service.on('snapshot', handleSnapshot)
    service.on('error', handleError)
    service.on('stopped', handleStopped)
    service.on('reconnected', handleReconnected)

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
      service.off('reconnected', handleReconnected)
      // Note: Don't stop service here - other components may be using it
      // Service is stopped via stopQueuePollingService() when app exits
    }
  }, [options?.consumerId, options?.pollInterval])

  return {
    error,
    isConnected,
    reconnectCount,
    sessionExecutions,
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
