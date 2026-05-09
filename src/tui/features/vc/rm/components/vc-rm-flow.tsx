import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcRmRequest} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcRm} from '../api/execute-vc-rm.js'
import {buildVcRmCompletionMessage} from './build-vc-rm-completion-message.js'

type VcRmFlowProps = CustomDialogCallbacks & {
  request: IVcRmRequest
}

export function VcRmFlow({onCancel, onComplete, request}: VcRmFlowProps): React.ReactNode {
  const rmMutation = useExecuteVcRm()

  useInput((_, key) => {
    if (key.escape && !rmMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    rmMutation.mutate(request, {
      onError(error) {
        onComplete(`Failed to remove: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        onComplete(buildVcRmCompletionMessage(result, {quiet: request.quiet}))
      },
    })
  }, [])

  const label = request.filePaths.length > 0 ? request.filePaths.join(' ') : '(pathspec from file)'

  return (
    <Box>
      <Text>
        <Spinner type="dots" /> Removing {label}...
      </Text>
    </Box>
  )
}
