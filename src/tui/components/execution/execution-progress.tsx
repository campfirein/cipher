/**
 * Execution Progress Component
 *
 * Displays tool calls progress with status indicators and parameters.
 * Shows a limited number of items with "... and X more" indicator.
 * Following OpenCode's pattern: shows tool parameters inline.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {ToolCallStatus} from '../../../core/domain/cipher/queue/types.js'

import {useTheme} from '../../hooks/index.js'

/** Default maximum number of lines (rows) for progress display */
const DEFAULT_MAX_LINES = 3

interface ProgressItem {
  /** Tool call arguments/parameters */
  args?: Record<string, unknown>
  id: string
  status: ToolCallStatus
  toolCallName: string
}

interface ExecutionProgressProps {
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
  /** Maximum number of lines (rows) this component can use, including hint line (default: 3) */
  maxLines?: number
  /** Array of progress items */
  progress: ProgressItem[]
}

/**
 * Format tool display with parameters based on tool type.
 * Following OpenCode's pattern: different tools show different key parameters.
 */
function formatToolDisplay(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return toolName

  // Tool-specific formatting (following OpenCode patterns)
  switch (toolName) {
    case 'read':
    case 'Read': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return `Read ${filePath}`
      break
    }

    case 'glob':
    case 'Glob': {
      const pattern = args.pattern
      const path = args.path
      if (pattern) {
        return path ? `Glob "${pattern}" in ${path}` : `Glob "${pattern}"`
      }
      break
    }

    case 'grep':
    case 'Grep': {
      const pattern = args.pattern
      const path = args.path
      if (pattern) {
        return path ? `Grep "${pattern}" in ${path}` : `Grep "${pattern}"`
      }
      break
    }

    case 'bash':
    case 'Bash': {
      const command = args.command
      if (command) {
        // Truncate long commands
        const cmdStr = String(command)
        return cmdStr.length > 60 ? `$ ${cmdStr.slice(0, 57)}...` : `$ ${cmdStr}`
      }
      break
    }

    case 'write':
    case 'Write': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return `Write ${filePath}`
      break
    }

    case 'edit':
    case 'Edit': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return `Edit ${filePath}`
      break
    }

    case 'task':
    case 'Task': {
      const description = args.description
      if (description) return `Task: ${description}`
      break
    }

    case 'web_search':
    case 'WebSearch': {
      const query = args.query
      if (query) return `Search: ${query}`
      break
    }

    case 'web_fetch':
    case 'WebFetch': {
      const url = args.url
      if (url) return `Fetch: ${url}`
      break
    }

    default:
      break
  }

  // Generic fallback: show first primitive arg
  const primitiveArgs = Object.entries(args).filter(
    ([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  )

  if (primitiveArgs.length > 0) {
    const [key, value] = primitiveArgs[0]
    const valueStr = String(value)
    const display = valueStr.length > 40 ? valueStr.slice(0, 37) + '...' : valueStr
    return `${toolName} [${key}=${display}]`
  }

  return toolName
}

export const ExecutionProgress: React.FC<ExecutionProgressProps> = ({
  isExpand = false,
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
  if (isExpand) {
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
            <Text color={colors.dimText}>{formatToolDisplay(item.toolCallName, item.args)}</Text>
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
          <Text color={colors.dimText}>{formatToolDisplay(item.toolCallName, item.args)}</Text>
        </Box>
      ))}
    </Box>
  )
}
