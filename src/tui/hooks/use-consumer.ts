/**
 * Consumer Hook
 *
 * Hook to manage consumer lifecycle
 */

import {useEffect, useState} from 'react'

import type {ConsumerStatus} from '../types.js'

import {ConsumerService} from '../../infra/cipher/consumer/consumer-service.js'

export function useConsumer(): {
  consumerError: Error | null
  consumerId: null | string
  consumerStatus: ConsumerStatus
} {
  const [status, setStatus] = useState<ConsumerStatus>('starting')
  const [consumerError, setConsumerError] = useState<Error | null>(null)
  const [consumerId, setConsumerId] = useState<null | string>(null)
  const [consumer] = useState(() => new ConsumerService())

  useEffect(() => {
    let mounted = true

    const startConsumer = async (): Promise<void> => {
      try {
        await consumer.start()
        if (mounted) {
          setStatus('running')
          setConsumerId(consumer.getConsumerId())
        }
      } catch (error) {
        if (mounted) {
          setStatus('error')
          setConsumerError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    startConsumer()

    return () => {
      mounted = false
      consumer.dispose()
      setStatus('stopped')
    }
  }, [consumer])

  return {consumerError, consumerId, consumerStatus: status}
}
