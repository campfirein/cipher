/**
 * PullFlow Component
 *
 * Checks for local changes, subscribes to progress, executes pull.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {PullProgressEvent} from '../../../../shared/transport/events/index.js'
import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {PullEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useExecutePull} from '../api/execute-pull.js'
import {usePreparePull} from '../api/prepare-pull.js'

interface PullFlowProps extends CustomDialogCallbacks {
  branch: string
}

type PullStep = 'executing' | 'preparing'

export function PullFlow({branch, onComplete}: PullFlowProps): React.ReactNode {
  const [step, setStep] = useState<PullStep>('preparing')
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const {data: prepareData, error: prepareError, isLoading: isPreparing} = usePreparePull({branch})
  const executeMutation = useExecutePull()

  // Handle prepare result
  useEffect(() => {
    if (isPreparing || step !== 'preparing') return

    if (prepareError) {
      onComplete(`Failed to pull: ${prepareError.message}`)
      return
    }

    if (prepareData?.hasChanges) {
      onComplete('You have local changes that have not been pushed. Run "/push" first.')
      return
    }

    if (prepareData) {
      setStep('executing')
    }
  }, [isPreparing, onComplete, prepareData, prepareError, step])

  // Execute pull and subscribe to progress
  useEffect(() => {
    if (step !== 'executing') return

    const {apiClient} = useTransportStore.getState()
    let unsubProgress: (() => void) | undefined

    if (apiClient) {
      unsubProgress = apiClient.on<PullProgressEvent>(PullEvents.PROGRESS, (data) => {
        setProgressMessages((prev) => [...prev, data.message])
      })
    }

    executeMutation.mutate(
      {branch},
      {
        onError(error) {
          unsubProgress?.()
          onComplete(`Failed to pull: ${error.message}`)
        },
        onSuccess(result) {
          unsubProgress?.()
          if (result.success) {
            onComplete(`\nSuccessfully pulled context tree from ByteRover memory storage!\n  Branch: ${branch}`)
          }
        },
      },
    )

    return () => {
      unsubProgress?.()
    }
  }, [step])

  if (step === 'preparing' && isPreparing) {
    return (
      <Text>
        <Spinner type="dots" /> Checking for local Context Tree changes...
      </Text>
    )
  }

  if (step === 'executing') {
    return (
      <>
        {progressMessages.map((msg, i) => (
          <Text key={i}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Pulling...
        </Text>
      </>
    )
  }

  return null
}
