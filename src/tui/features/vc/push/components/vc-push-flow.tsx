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
import {useExecuteVcPush} from '../api/execute-vc-push.js'

type PushStep = 'configuring_remote' | 'pushing'

type VcPushFlowProps = CustomDialogCallbacks & {
  branch?: string
  setUpstream?: boolean
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

export function VcPushFlow({branch, onCancel, onComplete, setUpstream}: VcPushFlowProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  const [step, setStep] = useState<PushStep>('pushing')
  const pushMutation = useExecuteVcPush()
  const remoteMutation = useExecuteVcRemote()

  useInput((_, key) => {
    if (key.escape && !pushMutation.isPending && !remoteMutation.isPending) {
      onCancel()
    }
  })

  const executePush = useCallback(
    (overrideSetUpstream?: boolean) => {
      pushMutation.mutate(
        {branch, setUpstream: overrideSetUpstream ?? setUpstream},
        {
          onError(error) {
            if (getTransportErrorCode(error) === VcErrorCode.NO_REMOTE) {
              setStep('configuring_remote')
              return
            }

            onComplete(`Failed to push: ${formatTransportError(error)}`)
          },
          onSuccess(result) {
            if (result.alreadyUpToDate) {
              onComplete('Everything up-to-date.')
            } else if (result.upstreamSet) {
              onComplete(`Pushed to origin/${result.branch} and set upstream.`)
            } else {
              onComplete(`Pushed to origin/${result.branch}.`)
            }
          },
        },
      )
    },
    [branch, onComplete, pushMutation, setUpstream],
  )

  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    executePush()
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
            setStep('pushing')
            executePush(true)
          },
        },
      )
    },
    [executePush, onComplete, remoteMutation],
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
      <Spinner type="dots" /> {branch ? `Pushing to origin/${branch}...` : 'Pushing...'}
    </Text>
  )
}
