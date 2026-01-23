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
import {ReasoningText} from '../reasoning-text.js'
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
}

/**
 * Check if there are any active (running) tool calls in the log
 */
function hasActiveToolCalls(log: ActivityLog): boolean {
  return Boolean(log.progress?.some((p) => p.status === 'running'))
}

export const LogItem: React.FC<LogItemProps> = memo(({heights, isExpand, isSelected, log}) => {
  const {
    theme: {colors},
  } = useTheme()

  const displayTime = formatTime(log.timestamp)

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box>
        <Text color={log.type === 'curate' ? colors.curateCommand : colors.queryCommand}>[{log.type}] </Text>
        <Text color={colors.dimText}>@{log.source ?? 'system'}</Text>
        {isSelected && (
          <Text dimColor italic>  ←  [ctrl+o] to {isExpand ? 'collapse' : 'expand'}</Text>
        )}
        <Spacer />
        <Text color={colors.dimText}>[{displayTime}]</Text>
      </Box>

      {/* Input */}
      <ExecutionInput input={log.input} isExpand={isExpand} />

      {/* Progress */}
      {log.progress && (
        <ExecutionProgress isExpand={isExpand} maxLines={heights.maxProgressItems} progress={log.progress} />
      )}

      {/* Reasoning/Thinking Content - Show when LLM is thinking (has reasoning content) */}
      {log.reasoningContent && log.status === 'running' && (
        <ReasoningText
          content={log.reasoningContent}
          isStreaming={Boolean(log.isStreaming)}
          maxLines={isExpand ? 0 : heights.maxContentLines}
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

      {/* Thinking indicator - Show when running but no tools, no reasoning, and no streaming content */}
      {log.status === 'running' && !log.reasoningContent && !log.streamingContent && !hasActiveToolCalls(log) && (
        <ReasoningText
          content=""
          isStreaming={true}
          maxLines={0}
        />
      )}

      {/* Final Content - Show after completion or error */}
      {(log.status === 'failed' || log.status === 'completed') && (
        <ExecutionContent
          bottomMargin={heights.contentBottomMargin}
          content={log.content ?? ''}
          isError={log.status === 'failed'}
          isExpand={isExpand}
          maxLines={heights.maxContentLines}
        />
      )}

      {/* Changes */}
      {log.status === 'completed' && (
        <ExecutionChanges
          created={log.changes.created}
          isExpand={isExpand}
          maxChanges={heights.maxChanges}
          updated={log.changes.updated}
        />
      )}
    </Box>
  )
})
LogItem.displayName = 'LogItem'
