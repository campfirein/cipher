/**
 * NewSessionFlow Component
 *
 * Optionally confirms, then signals a new session via side effects.
 */

import React, {useState} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {InlineConfirm} from '../../../components/inline-prompts/inline-confirm.js'

interface NewSessionFlowProps extends CustomDialogCallbacks {
  skipConfirm?: boolean
}

type SessionStep = 'confirm' | 'done'

export function NewSessionFlow({onComplete, skipConfirm}: NewSessionFlowProps): React.ReactNode {
  const [step, setStep] = useState<SessionStep>(skipConfirm ? 'done' : 'confirm')

  // If skipConfirm, complete immediately on first render
  if (step === 'done') {
    // Use setTimeout to avoid calling onComplete during render
    setTimeout(() => onComplete('Starting new session...'), 0)
    return null
  }

  if (step === 'confirm') {
    return (
      <InlineConfirm
        default={false}
        message="Start a new session (ends current session and clears conversation history)"
        onConfirm={(confirmed) => {
          if (confirmed) {
            setStep('done')
          } else {
            onComplete('Cancelled.')
          }
        }}
      />
    )
  }

  return null
}
