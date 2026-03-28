import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {IVcResetRequest, VcResetMode} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {InlineConfirm} from '../../../../components/inline-prompts/inline-confirm.js'
import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcReset} from '../api/execute-vc-reset.js'

type VcResetFlowProps = CustomDialogCallbacks & {
  filePaths?: string[]
  mode?: VcResetMode
  ref?: string
}

type ResetStep = 'confirm' | 'executing'

export function VcResetFlow({filePaths, mode, onCancel, onComplete, ref}: VcResetFlowProps): React.ReactNode {
  const needsConfirm = mode === 'hard'
  const [step, setStep] = useState<ResetStep>(needsConfirm ? 'confirm' : 'executing')
  const resetMutation = useExecuteVcReset()

  useInput((_, key) => {
    if (key.escape && !resetMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    if (step !== 'executing') return

    const request: IVcResetRequest = filePaths
      ? {filePaths}
      : {mode: mode ?? 'mixed', ref}

    resetMutation.mutate(request, {
      onError(error) {
        onComplete(`Failed to reset: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        if (result.filesUnstaged === undefined) {
          const sha = result.headSha ? result.headSha.slice(0, 7) : 'unknown'
          onComplete(`HEAD is now at ${sha}`)
        } else if (result.filesUnstaged === 0) {
          onComplete('Nothing to unstage.')
        } else {
          onComplete(`Unstaged ${result.filesUnstaged} file(s).`)
        }
      },
    })
  }, [step])

  if (step === 'confirm') {
    return (
      <InlineConfirm
        default={false}
        message={`This will discard all changes and reset to ${ref ?? 'HEAD'}. Continue`}
        onConfirm={(confirmed) => {
          if (confirmed) {
            setStep('executing')
          } else {
            onComplete('Reset cancelled.')
          }
        }}
      />
    )
  }

  const label = filePaths
    ? `Unstaging ${filePaths.join(' ')}...`
    : mode === 'soft'
      ? `Soft resetting to ${ref ?? 'HEAD'}...`
      : mode === 'hard'
        ? `Hard resetting to ${ref ?? 'HEAD'}...`
        : 'Unstaging all files...'

  return (
    <Text>
      <Spinner type="dots" /> {label}
    </Text>
  )
}
