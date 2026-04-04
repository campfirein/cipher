import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useRef, useState} from 'react'

import type {IVcCloneProgressEvent} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {InlineInput} from '../../../../components/inline-prompts/inline-input.js'
import {getWebAppUrl} from '../../../../lib/environment.js'
import {useTransportStore} from '../../../../stores/transport-store.js'
import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcClone} from '../api/execute-vc-clone.js'

type CloneStep = 'cloning' | 'entering_url'

interface VcCloneFlowProps extends CustomDialogCallbacks {
  url?: string
}

function validateRemoteUrl(value: string): boolean | string {
  if (!value) return 'URL is required'
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') {
      return 'URL must start with https://'
    }

    return true
  } catch {
    return 'Invalid URL'
  }
}

export function VcCloneFlow({onCancel, onComplete, url}: VcCloneFlowProps): React.ReactNode {
  const [step, setStep] = useState<CloneStep>(url ? 'cloning' : 'entering_url')
  const [cloneUrl, setCloneUrl] = useState<null | string>(url ?? null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const mutatedRef = useRef(false)

  const cloneMutation = useExecuteVcClone()

  useInput((_, key) => {
    if (key.escape && !cloneMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    if (step !== 'cloning' || mutatedRef.current || !cloneUrl) return
    mutatedRef.current = true

    const {apiClient} = useTransportStore.getState()
    const unsub = apiClient?.on<IVcCloneProgressEvent>(VcEvents.CLONE_PROGRESS, (evt) => {
      setProgressMessages((prev) => [...prev, evt.message])
    })

    cloneMutation.mutate(
      {url: cloneUrl},
      {
        onError(err) {
          unsub?.()
          mutatedRef.current = false
          if (url) {
            onComplete(formatTransportError(err))
          } else {
            setStep('entering_url')
          }
        },
        onSuccess(result) {
          unsub?.()
          const label =
            result.teamName && result.spaceName ? `${result.teamName}/${result.spaceName}` : 'repository'
          onComplete(`Cloned ${label} successfully.`)
        },
      },
    )

    return () => {
      unsub?.()
    }
  }, [onComplete, step, cloneUrl, url])

  const handleUrlSubmit = useCallback((submittedUrl: string) => {
    setCloneUrl(submittedUrl)
    setStep('cloning')
  }, [])

  if (step === 'cloning') {
    return (
      <>
        {progressMessages.map((msg, idx) => (
          <Text key={idx}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Cloning...
        </Text>
      </>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text>To clone a space:</Text>
        <Text>
          {'  '}Go to <Text bold>{getWebAppUrl()}</Text> → create or open a Space
        </Text>
        <Text>{'  '}and copy the remote URL.</Text>
      </Box>
      <InlineInput
        message="Paste your remote URL:"
        onSubmit={handleUrlSubmit}
        validate={validateRemoteUrl}
      />
    </Box>
  )
}
