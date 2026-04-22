import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useReducer, useRef} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {InlinePassword} from '../../../../components/inline-prompts/index.js'
import {useExecuteVcCommit} from '../api/execute-vc-commit.js'
import {initialCommitFlowState, reduceCommitFlow} from './vc-commit-flow-state.js'

type VcCommitFlowProps = CustomDialogCallbacks & {
  message: string
}

export function VcCommitFlow({message, onCancel, onComplete}: VcCommitFlowProps): React.ReactNode {
  const commitMutation = useExecuteVcCommit()
  const [state, dispatch] = useReducer(reduceCommitFlow, initialCommitFlowState)

  // Escape aborts only while committing (not mid-passphrase-entry — the input
  // component owns Escape there so the user can cancel the prompt).
  useInput((_, key) => {
    if (key.escape && state.kind === 'committing' && !commitMutation.isPending) {
      onCancel()
    }
  })

  const fireCommit = useCallback(
    (passphrase?: string) => {
      commitMutation.mutate(
        passphrase === undefined ? {message} : {message, passphrase},
        {
          onError(error) {
            dispatch({error, type: 'commit-error'})
          },
          onSuccess(result) {
            dispatch({
              message: result.message,
              sha: result.sha,
              type: 'commit-success',
              ...(result.signed ? {signed: true} : {}),
            })
          },
        },
      )
    },
    [commitMutation, message],
  )

  // First commit attempt
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fireCommit()
  }, [fireCommit])

  // Terminal state → bubble up to dialog manager.
  //
  // Also drop the passphrase from React-Query's mutation.variables. The
  // library retains variables until `reset()` or GC (~5 min), so without
  // this the plaintext passphrase keeps living in TUI memory after the
  // commit succeeds — visible to devtools, error boundaries, diagnostic
  // dumpers. Cleared even on error/cancel terminal states for symmetry.
  useEffect(() => {
    if (state.kind === 'done') {
      commitMutation.reset()
      onComplete(state.message)
    }
  }, [state, onComplete, commitMutation])

  if (state.kind === 'awaiting-passphrase') {
    return (
      <InlinePassword
        message="Enter SSH key passphrase:"
        onCancel={() => dispatch({type: 'passphrase-cancelled'})}
        onSubmit={(pp) => {
          dispatch({type: 'passphrase-submitted'})
          fireCommit(pp)
        }}
      />
    )
  }

  if (state.kind === 'committing') {
    return (
      <Text>
        <Spinner type="dots" /> Committing...
      </Text>
    )
  }

  // Terminal — useEffect above bubbles the outcome; render nothing
  return null
}

// Re-export so consumers (e.g., tests) can inspect the underlying state shape.
export type {CommitFlowState} from './vc-commit-flow-state.js'
