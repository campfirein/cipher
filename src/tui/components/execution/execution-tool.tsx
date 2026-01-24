/**
 * Execution Tool Component
 *
 * Displays a single tool call with status indicator and parameters.
 * Following OpenCode's pattern: shows tool parameters inline.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {ToolCallStatus} from '../../../core/domain/cipher/queue/types.js'

import {useTheme} from '../../hooks/index.js'

interface ToolCallItem {
  /** Tool call arguments/parameters */
  args?: Record<string, unknown>
  id: string
  status: ToolCallStatus
  toolCallName: string
}

interface ExecutionToolProps {
  /** Whether content should be fully expanded (no truncation) */
  isExpanded?: boolean
  /** Single tool call item to display */
  toolCall: ToolCallItem
}

interface ToolDisplayParts {
  toolArguments?: string
  toolName: string
}

/**
 * Format tool display with parameters based on tool type.
 * Returns separate parts for tool name and arguments for independent styling.
 */
function formatToolDisplay(toolName: string, args?: Record<string, unknown>, isExpanded = false): ToolDisplayParts {
  if (!args) return {toolName}

  // Tool-specific formatting (following OpenCode patterns)
  switch (toolName) {
    case 'bash':
    case 'Bash': {
      const {command} = args
      if (command) {
        const cmdStr = String(command)
        // Truncate long commands unless expanded
        const display = isExpanded || cmdStr.length <= 60 ? cmdStr : cmdStr.slice(0, 57) + '...'
        return {toolArguments: `$ ${display}`, toolName: 'Bash'}
      }

      break
    }

    case 'edit':
    case 'Edit': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return {toolArguments: String(filePath), toolName: 'Edit'}
      break
    }

    case 'glob':
    case 'Glob': {
      const {pattern} = args
      const {path} = args
      if (pattern) {
        const display = path ? `"${pattern}" in ${path}` : `"${pattern}"`
        return {toolArguments: display, toolName: 'Glob'}
      }

      break
    }

    case 'grep':
    case 'Grep': {
      const {pattern} = args
      const {path} = args
      if (pattern) {
        const display = path ? `"${pattern}" in ${path}` : `"${pattern}"`
        return {toolArguments: display, toolName: 'Grep'}
      }

      break
    }

    case 'read':
    case 'Read': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return {toolArguments: String(filePath), toolName: 'Read'}
      break
    }

    case 'task':
    case 'Task': {
      const {description} = args
      if (description) return {toolArguments: String(description), toolName: 'Task'}
      break
    }

    case 'web_fetch':
    case 'WebFetch': {
      const {url} = args
      if (url) return {toolArguments: String(url), toolName: 'Fetch'}
      break
    }

    case 'web_search':
    case 'WebSearch': {
      const {query} = args
      if (query) return {toolArguments: String(query), toolName: 'Search'}
      break
    }

    case 'write':
    case 'Write': {
      const filePath = args.file_path ?? args.filePath
      if (filePath) return {toolArguments: String(filePath), toolName: 'Write'}
      break
    }

    default: {
      break
    }
  }

  // Generic fallback: show first primitive arg
  const primitiveArgs = Object.entries(args).filter(
    ([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  )

  if (primitiveArgs.length > 0) {
    const [key, value] = primitiveArgs[0]
    const valueStr = String(value)
    // Truncate unless expanded
    const display = isExpanded || valueStr.length <= 40 ? valueStr : valueStr.slice(0, 37) + '...'
    return {toolArguments: `[${key}=${display}]`, toolName}
  }

  return {toolName}
}

export const ExecutionTool: React.FC<ExecutionToolProps> = ({isExpanded = false, toolCall}) => {
  const {
    theme: {colors},
  } = useTheme()

  const {toolArguments, toolName} = formatToolDisplay(toolCall.toolCallName, toolCall.args, isExpanded)

  return (
    <Box>
      {toolCall.status === 'completed' && <Text color={colors.primary}>✓ </Text>}
      {toolCall.status === 'running' && (
        <Text color={colors.dimText}>
          <Spinner type="dots" />{' '}
        </Text>
      )}
      {toolCall.status === 'failed' && <Text color={colors.errorText}>✗ </Text>}
      <Text>
        <Text color={colors.text}>{toolName}</Text>
        {toolArguments && <Text color={colors.dimText}> {toolArguments}</Text>}
      </Text>
    </Box>
  )
}
