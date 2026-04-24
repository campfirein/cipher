/**
 * VcDiffFlow Component
 *
 * Shows file-by-file diffs between commits, the index, or the working tree.
 * Mirrors `git diff` output: `diff --git`, `index`, `--- a/`, `+++ b/`, hunk headers, +/- lines.
 */

import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {VcDiffMode} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcDiff} from '../api/execute-vc-diff.js'
import {formatDiff} from '../utils/format-diff.js'

type VcDiffFlowProps = CustomDialogCallbacks & {
  mode: VcDiffMode
}

export function VcDiffFlow({mode, onCancel, onComplete}: VcDiffFlowProps): React.ReactNode {
  const diffMutation = useExecuteVcDiff()

  useInput((_, key) => {
    if (key.escape && !diffMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    diffMutation.mutate(
      {mode},
      {
        onError(error) {
          onComplete(`Failed to compute diff: ${formatTransportError(error)}`)
        },
        onSuccess(result) {
          const text = formatDiff(result)
          onComplete(text.length === 0 ? 'No changes.' : text.replace(/\n$/, ''))
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Computing diff...
    </Text>
  )
}
