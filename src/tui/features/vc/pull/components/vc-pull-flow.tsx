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
import {useExecuteVcPull} from '../api/execute-vc-pull.js'

type PullStep = 'configuring_remote' | 'pulling'

type VcPullFlowProps = CustomDialogCallbacks & {
  allowUnrelatedHistories?: boolean
  branch?: string
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

export function VcPullFlow({allowUnrelatedHistories, branch, onCancel, onComplete, remote}: VcPullFlowProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  const [step, setStep] = useState<PullStep>('pulling')
  const pullMutation = useExecuteVcPull()
  const remoteMutation = useExecuteVcRemote()

  useInput((_, key) => {
    if (key.escape && !pullMutation.isPending && !remoteMutation.isPending) {
      onCancel()
    }
  })

  const executePull = useCallback(() => {
    pullMutation.mutate(
      {allowUnrelatedHistories, branch, remote},
      {
        onError(error) {
          if (getTransportErrorCode(error) === VcErrorCode.NO_REMOTE) {
            setStep('configuring_remote')
            return
          }

          onComplete(`Failed to pull: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          if (result.conflicts && result.conflicts.length > 0) {
            const conflictLines = result.conflicts
              .map((c) => `CONFLICT (${c.type}): ${c.path}`)
              .join('\n')
            onComplete(
              `${conflictLines}\nAutomatic merge failed; fix conflicts and then commit the result.`,
            )
          } else {
            onComplete(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
          }
        },
      },
    )
  }, [allowUnrelatedHistories, branch, onComplete, pullMutation, remote])

  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    executePull()
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
            setStep('pulling')
            executePull()
          },
        },
      )
    },
    [executePull, onComplete, remoteMutation],
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
      <Spinner type="dots" /> Pulling...
    </Text>
  )
}
