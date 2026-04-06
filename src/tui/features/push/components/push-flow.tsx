/**
 * PushFlow Component
 *
 * Prepares push, optionally confirms, subscribes to progress, executes.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {PushProgressEvent} from '../../../../shared/transport/events/index.js'
import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {PushEvents} from '../../../../shared/transport/events/index.js'
import {InlineConfirm} from '../../../components/inline-prompts/inline-confirm.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {formatTransportError} from '../../../utils/error-messages.js'
import {useExecutePush} from '../api/execute-push.js'
import {usePreparePush} from '../api/prepare-push.js'

interface PushFlowProps extends CustomDialogCallbacks {
  branch: string
  skipConfirm?: boolean
}

type PushStep = 'confirm' | 'executing' | 'preparing'

export function PushFlow({branch, onComplete, skipConfirm}: PushFlowProps): React.ReactNode {
  const [step, setStep] = useState<PushStep>('preparing')
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const {data: prepareData, error: prepareError, isLoading: isPreparing} = usePreparePush({branch})
  const executeMutation = useExecutePush()

  // Handle prepare result
  useEffect(() => {
    if (isPreparing || step !== 'preparing') return

    if (prepareError) {
      onComplete(`Failed to push: ${formatTransportError(prepareError)}`)
      return
    }

    if (prepareData && !prepareData.hasChanges) {
      if (prepareData.excludedReviewCount > 0) {
        const fileLabel = prepareData.excludedReviewCount === 1 ? 'file is' : 'files are'
        onComplete(
          `No pushable changes. ${prepareData.excludedReviewCount} ${fileLabel} pending review.` +
            (prepareData.reviewUrl ? `\n  Review: ${prepareData.reviewUrl}` : ''),
        )
      } else {
        onComplete('No context changes to push.')
      }

      return
    }

    if (prepareData) {
      if (skipConfirm) {
        setStep('executing')
      } else {
        setStep('confirm')
      }
    }
  }, [isPreparing, onComplete, prepareData, prepareError, skipConfirm, step])

  // Execute push and subscribe to progress
  useEffect(() => {
    if (step !== 'executing') return

    const {apiClient} = useTransportStore.getState()
    let unsubProgress: (() => void) | undefined

    if (apiClient) {
      unsubProgress = apiClient.on<PushProgressEvent>(PushEvents.PROGRESS, (data) => {
        setProgressMessages((prev) => [...prev, data.message])
      })
    }

    executeMutation.mutate(
      {branch},
      {
        onError(error) {
          unsubProgress?.()
          onComplete(`Failed to push: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          unsubProgress?.()
          if (result.success) {
            onComplete(
              `✓ Successfully pushed context tree to ByteRover memory storage!\n  Branch: ${branch}\n  Changes: ${prepareData?.summary ?? 'unknown'}\n  View: ${result.url}`,
            )
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
        <Spinner type="dots" /> Checking for Context Tree changes...
      </Text>
    )
  }

  if (step === 'confirm' && prepareData) {
    return (
      <>
        <Text>{`Changes found: ${prepareData.summary} (${prepareData.fileCount} files)`}</Text>
        {prepareData.excludedReviewCount > 0 && (
          <Text color="yellow">
            {`⚠ ${prepareData.excludedReviewCount} file(s) excluded from push (pending/rejected review).`}
            {prepareData.reviewUrl ? `\n  Review: ${prepareData.reviewUrl}` : ''}
          </Text>
        )}
        <Text>{`\nYou are about to push to ByteRover memory storage:`}</Text>
        <Text>{`  Branch: ${branch}`}</Text>
        <InlineConfirm
          default={false}
          message="Push to ByteRover"
          onConfirm={(confirmed) => {
            if (confirmed) {
              setStep('executing')
            } else {
              onComplete('Push cancelled.')
            }
          }}
        />
      </>
    )
  }

  if (step === 'executing') {
    return (
      <>
        {progressMessages.map((msg, i) => (
          <Text key={i}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Pushing...
        </Text>
      </>
    )
  }

  return null
}
