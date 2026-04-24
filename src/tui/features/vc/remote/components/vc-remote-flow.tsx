import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {VcRemoteSubcommand} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcRemote} from '../api/execute-vc-remote.js'

type VcRemoteFlowProps = CustomDialogCallbacks & {
  subcommand: VcRemoteSubcommand
  url?: string
}

const LABELS: Record<VcRemoteSubcommand, string> = {
  add: 'Adding remote...',
  remove: 'Removing remote...',
  'set-url': 'Updating remote...',
  show: 'Fetching remote...',
}

export function VcRemoteFlow({onCancel, onComplete, subcommand, url}: VcRemoteFlowProps): React.ReactNode {
  const remoteMutation = useExecuteVcRemote()

  useInput((_, key) => {
    if (key.escape && !remoteMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    remoteMutation.mutate(
      {subcommand, url},
      {
        onError(error) {
          onComplete(`Failed: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          switch (result.action) {
            case 'add': {
              onComplete(`Remote 'origin' set to ${result.url}.`)
              break
            }

            case 'remove': {
              onComplete(`Remote 'origin' removed.`)
              break
            }

            case 'set-url': {
              onComplete(`Remote 'origin' updated to ${result.url}.`)
              break
            }

            case 'show': {
              onComplete(result.url ? `origin: ${result.url}` : 'No remote configured.')
              break
            }
          }
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> {LABELS[subcommand]}
    </Text>
  )
}
