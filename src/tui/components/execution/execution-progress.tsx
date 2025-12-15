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

/** Default maximum number of visible progress items */
const DEFAULT_MAX_ITEMS = 3

interface ProgressItem {
  id: string
  status: ToolCallStatus
  toolCallName: string
}

interface ExecutionProgressProps {
  /** Maximum number of items to show (default: 3) */
  maxItems?: number
  /** Array of progress items */
  progress: ProgressItem[]
}

export const ExecutionProgress: React.FC<ExecutionProgressProps> = ({maxItems = DEFAULT_MAX_ITEMS, progress}) => {
  const {
    theme: {colors},
  } = useTheme()

  if (!progress || progress.length === 0) {
    return null
  }

  const hasMore = progress.length > maxItems
  const visibleItems = progress.slice(-maxItems).reverse()

  return (
    <Box flexDirection="column">
      {hasMore && <Text color={colors.dimText}>... and {progress.length - maxItems} more</Text>}
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
