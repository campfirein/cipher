import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcMergeRequest, VcMergeAction} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcMerge} from '../api/execute-vc-merge.js'

type VcMergeFlowProps = CustomDialogCallbacks & {
  action: VcMergeAction
  branch?: string
  message?: string
}

export function VcMergeFlow({action, branch, message, onCancel, onComplete}: VcMergeFlowProps): React.ReactNode {
  const mergeMutation = useExecuteVcMerge()

  useInput((_, key) => {
    if (key.escape && !mergeMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true

    const request: IVcMergeRequest = {action, branch, message}

    // For TUI --continue without message: send first to get defaultMessage, then commit with it
    if (action === 'continue' && !message) {
      mergeMutation.mutate(request, {
        onError(error) {
          onComplete(`Failed to continue merge: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          // Got defaultMessage — now commit with it silently (TUI can't spawn editor)
          const commitMessage = result.defaultMessage ?? 'Merge commit'
          mergeMutation.mutate(
            {action: 'continue', message: commitMessage},
            {
              onError(error) {
                onComplete(`Failed to continue merge: ${formatTransportError(error)}`)
              },
              onSuccess() {
                onComplete('Merge commit created.')
              },
            },
          )
        },
      })
      return
    }

    mergeMutation.mutate(request, {
      onError(error) {
        onComplete(`Failed to ${action} merge: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        if (result.action === 'abort') {
          onComplete('Merge aborted.')
          return
        }

        if (result.action === 'continue') {
          onComplete('Merge commit created.')
          return
        }

        // action: 'merge'
        if (result.alreadyUpToDate) {
          onComplete('Already up to date.')
        } else if (result.conflicts && result.conflicts.length > 0) {
          const conflictLines = result.conflicts
            .map((c) => `CONFLICT (${c.type}): ${c.path}`)
            .join('\n')
          onComplete(
            `${conflictLines}\nAutomatic merge failed; fix conflicts and then commit the result.`,
          )
        } else {
          onComplete(`Merged branch '${branch}'.`)
        }
      },
    })
  }, [])

  const statusText =
    action === 'abort' ? 'Aborting merge...' : action === 'continue' ? 'Continuing merge...' : `Merging ${branch}...`

  return (
    <Text>
      <Spinner type="dots" /> {statusText}
    </Text>
  )
}
