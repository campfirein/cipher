import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcPull} from '../api/execute-vc-pull.js'

type VcPullFlowProps = CustomDialogCallbacks & {
  branch?: string
}

export function VcPullFlow({branch, onCancel, onComplete}: VcPullFlowProps): React.ReactNode {
  const pullMutation = useExecuteVcPull()

  useInput((_, key) => {
    if (key.escape && !pullMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    pullMutation.mutate(
      {branch},
      {
        onError(error) {
          onComplete(`Failed to pull: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          onComplete(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> {branch ? `Pulling from origin/${branch}...` : 'Pulling...'}
    </Text>
  )
}
