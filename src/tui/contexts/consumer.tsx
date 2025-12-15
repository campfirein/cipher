/**
 * Consumer Context
 *
 * Global context for managing consumer service and queue polling state.
 * Consolidates useConsumer and useQueuePolling hooks into a single context.
 *
 * Usage:
 * ```tsx
 * const { consumerId, sessionExecutions, stats } = useConsumer()
 * ```
 */

import React, {createContext, useContext, useMemo} from 'react'

import type {ExecutionWithToolCalls, QueueStats} from '../../infra/cipher/consumer/queue-polling-service.js'
import type {ConsumerStatus} from '../types.js'

import {useConsumer as useConsumerHook} from '../hooks/use-consumer.js'
import {useQueuePolling} from '../hooks/use-queue-polling.js'

interface ConsumerContextValue {
  // From useConsumer hook
  consumerError: Error | null
  consumerId: null | string
  consumerStatus: ConsumerStatus

  // From useQueuePolling hook
  isConnected: boolean
  pollingError: Error | null
  reconnectCount: number
  restart: () => Promise<void>
  sessionExecutions: ExecutionWithToolCalls[]
  stats: null | QueueStats
}

const ConsumerContext = createContext<ConsumerContextValue | undefined>(undefined)

interface ConsumerProviderProps {
  children: React.ReactNode
}

export function ConsumerProvider({children}: ConsumerProviderProps): React.ReactElement {
  // Start consumer service
  const {consumerError, consumerId, consumerStatus, restart} = useConsumerHook()

  // Poll queue for executions and stats
  const {
    error: pollingError,
    isConnected,
    reconnectCount,
    sessionExecutions,
    stats,
  } = useQueuePolling({
    consumerId: consumerId ?? undefined,
    pollInterval: 1000,
  })

  const contextValue = useMemo(
    () => ({
      // Consumer state
      consumerError,
      consumerId,
      consumerStatus,
      // Queue polling state
      isConnected,

      pollingError,
      reconnectCount,
      restart,
      sessionExecutions,
      stats,
    }),
    [
      consumerError,
      consumerId,
      consumerStatus,
      restart,
      isConnected,
      pollingError,
      reconnectCount,
      sessionExecutions,
      stats,
    ],
  )

  return <ConsumerContext.Provider value={contextValue}>{children}</ConsumerContext.Provider>
}

export function useConsumer(): ConsumerContextValue {
  const context = useContext(ConsumerContext)
  if (!context) {
    throw new Error('useConsumer must be used within ConsumerProvider')
  }

  return context
}
