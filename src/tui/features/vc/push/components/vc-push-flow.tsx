import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcPush} from '../api/execute-vc-push.js'

type VcPushFlowProps = CustomDialogCallbacks & {
  branch?: string
  setUpstream?: boolean
}

export function VcPushFlow({branch, onCancel, onComplete, setUpstream}: VcPushFlowProps): React.ReactNode {
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
      {branch, setUpstream},
      {
        onError(error) {
          onComplete(`Failed to push: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          if (result.alreadyUpToDate) {
            onComplete('Everything up-to-date.')
          } else if (result.upstreamSet) {
            onComplete(`Pushed to origin/${result.branch} and set upstream.`)
          } else {
            onComplete(`Pushed to origin/${result.branch}.`)
          }
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> {branch ? `Pushing to origin/${branch}...` : 'Pushing...'}
    </Text>
  )
}
