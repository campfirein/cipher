import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useRef, useState} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {VcErrorCode} from '../../../../../shared/transport/events/vc-events.js'
import {InlineInput} from '../../../../components/inline-prompts/inline-input.js'
import {useTheme} from '../../../../hooks/index.js'
import {getWebAppUrl} from '../../../../lib/environment.js'
import {formatTransportError, getTransportErrorCode} from '../../../../utils/error-messages.js'
import {useExecuteVcRemote} from '../../remote/api/execute-vc-remote.js'
import {useExecuteVcFetch} from '../api/execute-vc-fetch.js'

type FetchStep = 'configuring_remote' | 'fetching'

type VcFetchFlowProps = CustomDialogCallbacks & {
  ref?: string
  remote?: string
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

export function VcFetchFlow({onCancel, onComplete, ref: refProp, remote}: VcFetchFlowProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  const [step, setStep] = useState<FetchStep>('fetching')
  const fetchMutation = useExecuteVcFetch()
  const remoteMutation = useExecuteVcRemote()

  useInput((_, key) => {
    if (key.escape && !fetchMutation.isPending && !remoteMutation.isPending) {
      onCancel()
    }
  })

  const executeFetch = useCallback(() => {
    fetchMutation.mutate(
      {ref: refProp, remote},
      {
        onError(error) {
          if (getTransportErrorCode(error) === VcErrorCode.NO_REMOTE) {
            setStep('configuring_remote')
            return
          }

          onComplete(`Failed to fetch: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          onComplete(`Fetched from ${result.remote}.`)
        },
      },
    )
  }, [fetchMutation, onComplete, refProp, remote])

  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    executeFetch()
  }, [])

  const handleUrlSubmit = useCallback(
    (url: string) => {
      remoteMutation.mutate(
        {subcommand: 'add', url},
        {
          onError(error) {
            onComplete(`Failed to add remote: ${formatTransportError(error)}`)
          },
          onSuccess() {
            setStep('fetching')
            executeFetch()
          },
        },
      )
    },
    [executeFetch, onComplete, remoteMutation],
  )

  if (step === 'configuring_remote') {
    if (remoteMutation.isPending) {
      return (
        <Text>
          <Spinner type="dots" /> Adding remote...
        </Text>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color={colors.warning}>No remote configured.</Text>
          <Text />
          <Text>To connect to cloud:</Text>
          <Text>  Go to <Text bold>{getWebAppUrl()}</Text> → create or open a Space</Text>
          <Text>  and copy the remote URL.</Text>
        </Box>
        <InlineInput
          message="Paste your remote URL:"
          onSubmit={handleUrlSubmit}
          validate={validateRemoteUrl}
        />
      </Box>
    )
  }

  return (
    <Text>
      <Spinner type="dots" /> Fetching...
    </Text>
  )
}
