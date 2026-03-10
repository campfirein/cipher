import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {useExecuteVcPush} from '../api/execute-vc-push.js'

type VcPushFlowProps = CustomDialogCallbacks & {
  branch?: string
}

export function VcPushFlow({branch, onCancel, onComplete}: VcPushFlowProps): React.ReactNode {
  const pushMutation = useExecuteVcPush()

  useInput((_, key) => {
    if (key.escape && !pushMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    pushMutation.mutate(
      {branch},
      {
        onError(error) {
          onComplete(`Failed to push: ${error.message}`)
        },
        onSuccess(result) {
          onComplete(`Pushed to origin/${result.branch}.`)
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Pushing to origin/{branch ?? '...'}...
    </Text>
  )
}
