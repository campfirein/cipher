// TODO(v0.5.0): Remove this file. ConsumerService is replaced by CoreProcess → TaskProcessor.

/**
 * Consumer Hook
 *
 * Hook to manage consumer lifecycle
 */

import {useCallback, useEffect, useRef, useState} from 'react'

import type {ConsumerStatus} from '../types.js'

import {ConsumerService} from '../../infra/cipher/consumer/consumer-service.js'
import {stopQueuePollingService} from '../../infra/cipher/consumer/queue-polling-service.js'

export function useConsumer(): {
  consumerError: Error | null
  consumerId: null | string
  consumerStatus: ConsumerStatus
  restart: () => Promise<void>
} {
  const [status, setStatus] = useState<ConsumerStatus>('starting')
  const [consumerError, setConsumerError] = useState<Error | null>(null)
  const [consumerId, setConsumerId] = useState<null | string>(null)
  const consumerRef = useRef<ConsumerService>(new ConsumerService())
  const mountedRef = useRef(true)

  const startConsumer = useCallback(async (): Promise<void> => {
    try {
      setStatus('starting')
      setConsumerError(null)
      await consumerRef.current.start()
      if (mountedRef.current) {
        setStatus('running')
        setConsumerId(consumerRef.current.getConsumerId())
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatus('error')
        setConsumerError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }, [])

  const restart = useCallback(async (): Promise<void> => {
    // IMPORTANT: Order matters for proper lock release!
    // 1. Dispose consumer FIRST - releases lock while AgentStorage is still open
    consumerRef.current.dispose()
    setStatus('stopped')
    setConsumerId(null)

    // 2. Stop queue polling AFTER - closes storage (idempotent if already closed)
    stopQueuePollingService()

    // Wait for cleanup to complete
    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })

    // Create new consumer and start
    consumerRef.current = new ConsumerService()
    await startConsumer()
  }, [startConsumer])

  useEffect(() => {
    mountedRef.current = true
    startConsumer()

    return () => {
      mountedRef.current = false
      consumerRef.current.dispose()
      setStatus('stopped')
    }
  }, [startConsumer])

  return {consumerError, consumerId, consumerStatus: status, restart}
}
