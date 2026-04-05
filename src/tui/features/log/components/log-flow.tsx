/**
 * LogFlow Component
 *
 * Fetches and displays git commit history for the context-tree via VcHandler.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useExecuteLog} from '../api/execute-log.js'
import {formatCommitLog} from '../utils/format-log.js'

type LogFlowProps = CustomDialogCallbacks & {
  all: boolean
  branch: string | undefined
  limit: number
}

export function LogFlow({all, branch, limit, onComplete}: LogFlowProps): React.ReactNode {
  const logMutation = useExecuteLog()

  useEffect(() => {
    logMutation.mutate(
      {all, limit, ref: branch},
      {
        onError(error) {
          onComplete(`Failed to get log: ${error.message.replace(/ for event '[^']+'$/, '')}`)
        },
        onSuccess(result) {
          if (result.commits.length === 0) {
            onComplete('No commits found.')
            return
          }

          onComplete(formatCommitLog(result.commits, result.currentBranch))
        },
      },
    )
  }, [])

  return (
    <Text>
      <Spinner type="dots" /> Loading commit history...
    </Text>
  )
}
