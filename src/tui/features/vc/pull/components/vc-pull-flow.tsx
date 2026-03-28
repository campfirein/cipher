import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcPull} from '../api/execute-vc-pull.js'

type VcPullFlowProps = CustomDialogCallbacks

export function VcPullFlow({onCancel, onComplete}: VcPullFlowProps): React.ReactNode {
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
      undefined,
      {
        onError(error) {
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
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Pulling...
    </Text>
  )
}
