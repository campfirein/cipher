import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcCommit} from '../api/execute-vc-commit.js'

type VcCommitFlowProps = CustomDialogCallbacks & {
  message: string
}

export function VcCommitFlow({message, onCancel, onComplete}: VcCommitFlowProps): React.ReactNode {
  const commitMutation = useExecuteVcCommit()

  useInput((_, key) => {
    if (key.escape && !commitMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    commitMutation.mutate(
      {message},
      {
        onError(error) {
          onComplete(`Failed to commit: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          onComplete(`[${result.sha.slice(0, 7)}] ${result.message}`)
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Committing...
    </Text>
  )
}
