/**
 * VcStatusFlow Component
 *
 * Shows git status of the context tree via VcHandler.
 */

import chalk from 'chalk'
import {Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {IVcStatusResponse} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {formatTransportError} from '../../../../utils/error-messages.js'
import {useExecuteVcStatus} from '../api/execute-vc-status.js'

type VcStatusFlowProps = CustomDialogCallbacks

// eslint-disable-next-line complexity
function formatVcStatus(result: IVcStatusResponse): string {
  if (!result.initialized) {
    return chalk.yellow('Git repository not initialized — run `/vc init` to initialize')
  }

  const lines: string[] = [chalk.bold(`On branch: ${result.branch ?? '(detached HEAD)'}`)]
  const {staged, unstaged, untracked} = result
  const hasChanges =
    staged.added.length > 0 ||
    staged.modified.length > 0 ||
    staged.deleted.length > 0 ||
    unstaged.modified.length > 0 ||
    unstaged.deleted.length > 0 ||
    untracked.length > 0

  if (!hasChanges) {
    lines.push('Nothing to commit, working tree clean')
    return lines.join('\n')
  }

  if (staged.added.length > 0 || staged.modified.length > 0 || staged.deleted.length > 0) {
    lines.push(chalk.bold('Changes to be committed:'))
    for (const f of staged.added) lines.push(chalk.green(`   new file:   ${f}`))
    for (const f of staged.modified) lines.push(chalk.green(`   modified:   ${f}`))
    for (const f of staged.deleted) lines.push(chalk.green(`   deleted:    ${f}`))
  }

  if (unstaged.modified.length > 0 || unstaged.deleted.length > 0) {
    lines.push(chalk.bold('Changes not staged for commit:'))
    for (const f of unstaged.modified) lines.push(chalk.red(`   modified:   ${f}`))
    for (const f of unstaged.deleted) lines.push(chalk.red(`   deleted:    ${f}`))
  }

  if (untracked.length > 0) {
    lines.push(chalk.bold('Untracked files:'))
    for (const f of untracked) lines.push(chalk.red(`   ${f}`))
  }

  return lines.join('\n')
}

export function VcStatusFlow({onCancel, onComplete}: VcStatusFlowProps): React.ReactNode {
  const statusMutation = useExecuteVcStatus()

  useInput((_, key) => {
    if (key.escape && !statusMutation.isPending) {
      onCancel()
    }
  })

  useEffect(() => {
    statusMutation.mutate(undefined, {
      onError(error) {
        onComplete(`Failed to get vc status: ${formatTransportError(error)}`)
      },
      onSuccess(result) {
        onComplete(formatVcStatus(result))
      },
    })
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Getting vc status...
    </Text>
  )
}
