/**
 * Execution Progress Component
 *
 * Displays tool calls progress with status indicators.
 * Shows a limited number of items with "... and X more" indicator.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {ToolCallStatus} from '../../../core/domain/cipher/queue/types.js'

import {useTheme} from '../../hooks/index.js'

/** Default maximum number of lines (rows) for progress display */
const DEFAULT_MAX_LINES = 3

interface ProgressItem {
  id: string
  status: ToolCallStatus
  toolCallName: string
}

interface ExecutionProgressProps {
  /** Whether content should be fully expanded (no truncation) */
  isExpanded?: boolean
  /** Maximum number of lines (rows) this component can use, including hint line (default: 3) */
  maxLines?: number
  /** Array of progress items */
  progress: ProgressItem[]
}

export const ExecutionProgress: React.FC<ExecutionProgressProps> = ({
  isExpanded,
  maxLines = DEFAULT_MAX_LINES,
  progress,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  if (!progress || progress.length === 0) {
    return null
  }

  // In expand mode, show all items without truncation
  if (isExpanded) {
    return (
      <Box flexDirection="column">
        {progress.map((item) => (
          <Box key={item.id}>
            {item.status === 'completed' && <Text color={colors.primary}>✓ </Text>}
            {item.status === 'running' && (
              <Text color={colors.dimText}>
                <Spinner type="dots" />{' '}
              </Text>
            )}
            {item.status === 'failed' && <Text color={colors.errorText}>✗ </Text>}
            <Text color={colors.dimText}>{item.toolCallName}</Text>
          </Box>
        ))}
      </Box>
    )
  }

  const hasMore = progress.length > maxLines
  // If there's overflow, reserve 1 line for hint, show (maxLines - 1) items
  const visibleCount = hasMore ? maxLines - 1 : maxLines
  const visibleItems = progress.slice(-visibleCount)

  return (
    <Box flexDirection="column">
      {hasMore && <Text color={colors.dimText}>... and {progress.length - visibleCount} more tools used</Text>}
      {visibleItems.map((item) => (
        <Box key={item.id}>
          {item.status === 'completed' && <Text color={colors.primary}>✓ </Text>}
          {item.status === 'running' && (
            <Text color={colors.dimText}>
              <Spinner type="dots" />{' '}
            </Text>
          )}
          {item.status === 'failed' && <Text color={colors.errorText}>✗ </Text>}
          <Text color={colors.dimText}>{item.toolCallName}</Text>
        </Box>
      ))}
    </Box>
  )
}
