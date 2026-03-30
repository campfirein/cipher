import chalk from 'chalk'
import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcConflictsResponse} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcConflicts} from '../api/execute-vc-conflicts.js'

type VcConflictsFlowProps = CustomDialogCallbacks

function formatConflicts(result: IVcConflictsResponse): string {
  const hasMarkers = result.files.length > 0
  const hasIndexConflicts = result.conflicts && result.conflicts.length > 0

  if (!hasMarkers && !hasIndexConflicts) {
    return 'No conflict markers found.'
  }

  const totalCount = result.files.length + (result.conflicts?.length ?? 0)
  const lines: string[] = [
    chalk.bold(`Found ${totalCount} conflicted file${totalCount === 1 ? '' : 's'}:`),
    '',
  ]
  for (const f of result.files) {
    lines.push(chalk.red(`   ${f}`))
  }

  if (result.conflicts) {
    for (const c of result.conflicts) {
      lines.push(chalk.red(`   ${c.path} (${c.type})`))
    }
  }

  lines.push('')
  // eslint-disable-next-line unicorn/no-array-push-push
  lines.push(chalk.yellow('Resolve conflicts and run "/vc add" before pushing.'))
  return lines.join('\n')
}

export function VcConflictsFlow({onCancel, onComplete}: VcConflictsFlowProps): React.ReactNode {
  const conflictsMutation = useExecuteVcConflicts()

  useInput((_, key) => {
    if (key.escape && !conflictsMutation.isPending) {
      onCancel()
    }
  })

  const fired = React.useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    conflictsMutation.mutate(undefined, {
      onError(error) {
        onComplete(`Failed to check conflicts: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        onComplete(formatConflicts(result))
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Checking for conflict markers...
    </Text>
  )
}
