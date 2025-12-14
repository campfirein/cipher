/**
 * Log Item Component
 *
 * Displays a single activity log entry with header, input, progress, content, and changes.
 */

import {Box, Spacer, Text} from 'ink'
import React from 'react'

import type {ActivityLog} from '../../types.js'

import {useTheme} from '../../hooks/index.js'
import {ExecutionChanges} from './execution-changes.js'
import {ExecutionContent} from './execution-content.js'
import {ExecutionInput} from './execution-input.js'
import {ExecutionProgress} from './execution-progress.js'
import {ExecutionStatus} from './execution-status.js'

/** Default maximum number of visible progress items */
const DEFAULT_MAX_PROGRESS_ITEMS = 3

interface LogItemProps {
  /** The activity log to display */
  log: ActivityLog
  /** Maximum number of content lines before truncation */
  maxContentLines: number
  /** Maximum number of progress items to show (default: 3) */
  maxProgressItems?: number
}

export const LogItem: React.FC<LogItemProps> = ({
  log,
  maxContentLines,
  maxProgressItems = DEFAULT_MAX_PROGRESS_ITEMS,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  // Format timestamp as local time HH:MM:SS
  const hours = log.timestamp.getHours().toString().padStart(2, '0')
  const minutes = log.timestamp.getMinutes().toString().padStart(2, '0')
  const seconds = log.timestamp.getSeconds().toString().padStart(2, '0')
  const displayTime = `${hours}:${minutes}:${seconds}`

  const displayTools = Math.min(log.progress?.length ?? 0, maxProgressItems) + 1

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box>
        <Text color={log.type === 'curate' ? colors.curateCommand : colors.queryCommand}>[{log.type}] </Text>
        <Text color={colors.dimText}>@{log.source ?? 'system'}</Text>
        <Spacer />
        <Text color={colors.dimText}>[{displayTime}]</Text>
      </Box>

      {/* Input */}
      <ExecutionInput input={log.input} />

      {/* Progress and Status */}
      <Box flexDirection="column">
        {log.progress && <ExecutionProgress maxItems={maxProgressItems} progress={log.progress} />}
        <ExecutionStatus status={log.status} />
      </Box>

      {/* Content */}
      {(log.status === 'failed' || log.status === 'completed') && (
        <ExecutionContent
          content={log.content ?? ''}
          isError={log.status === 'failed'}
          maxLines={maxContentLines - displayTools}
        />
      )}

      {/* Changes */}
      {log.status === 'completed' && <ExecutionChanges created={log.changes.created} updated={log.changes.updated} />}
    </Box>
  )
}
