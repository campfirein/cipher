import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcCheckoutRequest} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcCheckout} from '../api/execute-vc-checkout.js'

type VcCheckoutFlowProps = CustomDialogCallbacks & {
  request: IVcCheckoutRequest
}

export function VcCheckoutFlow({onCancel, onComplete, request}: VcCheckoutFlowProps): React.ReactNode {
  const checkoutMutation = useExecuteVcCheckout()

  useInput((_, key) => {
    if (key.escape && !checkoutMutation.isPending) onCancel()
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    checkoutMutation.mutate(request, {
      onError(error) {
        onComplete(`Failed: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        if (result.created) {
          onComplete(`Created and switched to branch '${result.branch}'.`)
        } else {
          onComplete(`Switched to branch '${result.branch}'.`)
        }
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Switching to branch '{request.branch}'...
    </Text>
  )
}
