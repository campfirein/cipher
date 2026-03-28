/**
 * VcInitFlow Component
 *
 * Initializes the git repository in .brv/context-tree/ via VcHandler.
 */

import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcInit} from '../api/execute-vc-init.js'

type VcInitFlowProps = CustomDialogCallbacks

export function VcInitFlow({onCancel, onComplete}: VcInitFlowProps): React.ReactNode {
  const initMutation = useExecuteVcInit()

  useInput((_, key) => {
    if (key.escape && !initMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    initMutation.mutate(undefined, {
      onError(error) {
        onComplete(`Failed to initialize: ${formatTransportError(error)}`)
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
