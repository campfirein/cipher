/**
 * InitFlow Component
 *
 * Initializes the git repository in .brv/context-tree/ via FooHandler.
 */

import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useExecuteInit} from '../api/execute-init.js'

type InitFlowProps = CustomDialogCallbacks

export function InitFlow({onCancel, onComplete}: InitFlowProps): React.ReactNode {
  const initMutation = useExecuteInit()

  useInput((_, key) => {
    if (key.escape && !initMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    initMutation.mutate(undefined, {
      onError(error) {
        onComplete(`Failed to initialize: ${error.message}`)
      },
      onSuccess(result) {
        const msg = result.reinitialized
          ? `Reinitialized Git repository in ${result.gitDir}`
          : `Initialized Git repository in ${result.gitDir}`
        onComplete(msg)
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Initializing git repository...
    </Text>
  )
}
