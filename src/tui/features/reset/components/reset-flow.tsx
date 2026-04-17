/**
 * ResetFlow Component
 *
 * Optionally confirms, then resets the context tree.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {InlineConfirm} from '../../../components/inline-prompts/inline-confirm.js'
import {formatTransportError} from '../../../utils/error-messages.js'
import {useExecuteReset} from '../api/execute-reset.js'

interface ResetFlowProps extends CustomDialogCallbacks {
  skipConfirm?: boolean
}

type ResetStep = 'confirm' | 'executing'

export function ResetFlow({onComplete, skipConfirm}: ResetFlowProps): React.ReactNode {
  const [step, setStep] = useState<ResetStep>(skipConfirm ? 'executing' : 'confirm')
  const resetMutation = useExecuteReset()

  // Execute reset
  useEffect(() => {
    if (step !== 'executing') return

    resetMutation.mutate(undefined, {
      onError(error) {
        onComplete(`Failed to reset context tree: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        if (result.success) {
          onComplete('Context tree reset successfully. Your context tree is now empty.')
        }
      },
    })
  }, [step])

  if (step === 'confirm') {
    return (
      <InlineConfirm
        default={false}
        message="Are you sure you want to reset the context tree? This will remove all existing context. Your context tree will be empty."
        onConfirm={(confirmed) => {
          if (confirmed) {
            setStep('executing')
          } else {
            onComplete('Cancelled. Context tree was not reset.')
          }
        }}
      />
    )
  }

  if (step === 'executing') {
    return (
      <Text>
        <Spinner type="dots" /> Resetting context tree...
      </Text>
    )
  }

  return null
}
