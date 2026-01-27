/**
 * Log Item Component
 *
 * Displays a single activity log entry with header, input, progress, content, and changes.
 */

import {Box, Spacer, Text} from 'ink'
import React, {memo} from 'react'

import type {MessageItemHeights} from '../../hooks/index.js'
import type {ActivityLog} from '../../types.js'

import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/index.js'
import {StreamingText} from '../streaming-text.js'
import {ExecutionChanges} from './execution-changes.js'
import {ExecutionContent} from './execution-content.js'
import {ExecutionInput} from './execution-input.js'
import {ExecutionProgress} from './execution-progress.js'

interface LogItemProps {
  /** Dynamic heights based on terminal breakpoint */
  heights: MessageItemHeights
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
  /** Whether this log item is currently selected */
  isSelected?: boolean
  /** The activity log to display */
  log: ActivityLog
  /** Whether to show the expand/collapse indicator */
  shouldShowExpand?: boolean
}

export const LogItem: React.FC<LogItemProps> = memo(({heights, isExpand, isSelected, log, shouldShowExpand = true}) => {
  const {
    theme: {colors},
  } = useTheme()

  const displayTime = formatTime(log.timestamp)

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box gap={1}>
        <Text color={colors.primary}>• {log.type}</Text>
        <Spacer />
        <Text color={colors.dimText}>{displayTime}</Text>
      </Box>
      <Box gap={1}>
        <Box
          borderBottom={false}
          borderColor={isSelected ? colors.primary : undefined}
          borderLeft={isSelected}
          borderRight={false}
          borderStyle="bold"
          borderTop={false}
          height="100%"
          width={1}
        />
        <Box borderTop={false} flexDirection="column" flexGrow={1}>
          {/* Input */}
          <ExecutionInput input={log.input} />

          {/* Progress */}
          {(log.toolCalls || log.reasoningContents) && log.status === 'running' && (
            <ExecutionProgress
              reasoningContents={log.reasoningContents}
              toolCalls={log.toolCalls}
            />
          )}

          {/* Streaming Text Content - Show when available, even during tool execution */}
          {log.streamingContent && log.status === 'running' && (
            <StreamingText
              content={log.streamingContent}
              isStreaming={Boolean(log.isStreaming)}
              maxLines={isExpand ? 0 : heights.maxContentLines}
              showCursor={Boolean(log.isStreaming)}
            />
          )}

          {/* Final Content - Show after completion or error */}
          {(log.status === 'failed' || log.status === 'completed') && (
            <ExecutionContent
              bottomMargin={0}
              content={log.content ?? ''}
              isError={log.status === 'failed'}
              maxLines={3}
            />
          )}

          {/* Changes */}
          {log.status === 'completed' && (
            <ExecutionChanges
              created={log.changes.created}
              marginTop={1}
              maxChanges={heights.maxChanges}
              updated={log.changes.updated}
            />
          )}

          {/* Expand indicator */}
          {isSelected && shouldShowExpand ? (
            <Text color={colors.dimText}>Show remaining output • [ctrl+o] to expand</Text>
          ) : (
            <Text> </Text>
          )}
        </Box>
      </Box>
    </Box>
  )
})
LogItem.displayName = 'LogItem'

