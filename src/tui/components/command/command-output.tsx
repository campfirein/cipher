/**
 * Command Output Components
 *
 * Shared utilities and components for rendering command output.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {StreamingMessage} from '../../types.js'

import {useTheme} from '../../hooks/index.js'
import {getVisualLineCount} from '../../utils/line.js'

/**
 * Maximum number of output lines to display in list view before truncation
 */
export const MAX_OUTPUT_LINES = 6

/**
 * Processed streaming message for rendering
 * Includes action state for spinner display
 */
export interface ProcessedMessage extends StreamingMessage {
  /** For action_start: whether the action is still running (no matching action_stop) */
  isActionRunning?: boolean
  /** For action_start: the completion message from action_stop */
  stopMessage?: string
}

/**
 * Calculate visual line count for a message
 */
export function getMessageVisualLineCount(message: StreamingMessage, terminalWidth: number): number {
  return message.content
    .split('\n')
    .reduce((total, line) => total + getVisualLineCount(line, terminalWidth), 0)
}

/**
 * Count total visual lines across all messages
 */
export function countOutputLines(messages: StreamingMessage[], terminalWidth: number): number {
  return messages.reduce((total, msg) => total + getMessageVisualLineCount(msg, terminalWidth), 0)
}

/**
 * Truncate message content from the end to fit within available visual lines
 */
export function truncateMessageFromEnd(
  message: StreamingMessage,
  availableLines: number,
  terminalWidth: number,
): {content: string; usedLines: number} {
  const lines = message.content.split('\n')
  const truncatedLines: string[] = []
  let usedLines = 0

  // Build from end, taking lines that fit
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const lineVisualCount = getVisualLineCount(line, terminalWidth)

    if (usedLines + lineVisualCount <= availableLines) {
      truncatedLines.unshift(line)
      usedLines += lineVisualCount
    } else if (usedLines < availableLines) {
      // Partial line - take last chars that fit
      const remainingLines = availableLines - usedLines
      const maxChars = remainingLines * terminalWidth
      truncatedLines.unshift(line.slice(-maxChars))
      usedLines = availableLines
      break
    } else {
      break
    }
  }

  return {content: truncatedLines.join('\n'), usedLines}
}

/**
 * Get messages from end that fit within maxLines (shows newest first)
 */
export function getMessagesFromEnd(
  messages: StreamingMessage[],
  maxLines: number,
  terminalWidth: number,
): {displayMessages: StreamingMessage[]; skippedLines: number; totalLines: number} {
  const totalLines = countOutputLines(messages, terminalWidth)

  if (totalLines <= maxLines) {
    return {displayMessages: messages, skippedLines: 0, totalLines}
  }

  const displayMessages: StreamingMessage[] = []
  let usedLines = 0

  // Iterate from end (newest first)
  for (let i = messages.length - 1; i >= 0 && usedLines < maxLines; i--) {
    const msg = messages[i]
    const msgLineCount = getMessageVisualLineCount(msg, terminalWidth)
    const availableLines = maxLines - usedLines

    if (msgLineCount <= availableLines) {
      // Whole message fits
      displayMessages.unshift(msg)
      usedLines += msgLineCount
    } else if (availableLines > 0) {
      // Truncate message to fit
      const {content, usedLines: truncatedLines} = truncateMessageFromEnd(msg, availableLines, terminalWidth)
      displayMessages.unshift({...msg, content})
      usedLines += truncatedLines
      break
    }
  }

  // Fallback: show at least last line of last message
  if (displayMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages.at(-1)!
    const lastLine = lastMsg.content.split('\n').at(-1) ?? ''
    displayMessages.push({...lastMsg, content: lastLine})
    usedLines = getVisualLineCount(lastLine, terminalWidth)
  }

  return {
    displayMessages,
    skippedLines: totalLines - usedLines,
    totalLines,
  }
}

/**
 * Process streaming messages to handle action_start/action_stop pairs
 * - action_start with matching action_stop: mark as completed with stop message
 * - action_start without matching action_stop: mark as running (show spinner)
 * - action_stop messages are filtered out (consumed by their action_start)
 */
export function processMessagesForActions(messages: StreamingMessage[]): ProcessedMessage[] {
  // Build a map of actionId -> action_stop message
  const stopMessages = new Map<string, string>()
  for (const msg of messages) {
    if (msg.type === 'action_stop' && msg.actionId) {
      stopMessages.set(msg.actionId, msg.content)
    }
  }

  // Process messages, transforming action_start and filtering action_stop
  const result: ProcessedMessage[] = []
  for (const msg of messages) {
    if (msg.type === 'action_stop') {
      // Skip action_stop messages - they're consumed by action_start
      continue
    }

    if (msg.type === 'action_start' && msg.actionId) {
      const stopMessage = stopMessages.get(msg.actionId)
      result.push({
        ...msg,
        isActionRunning: stopMessage === undefined,
        stopMessage,
      })
    } else {
      result.push(msg)
    }
  }

  return result
}

export interface StreamingMessageItemProps {
  message: ProcessedMessage
}

/**
 * Renders a single streaming message
 */
export const StreamingMessageItem: React.FC<StreamingMessageItemProps> = ({message}) => {
  const {theme: {colors}} = useTheme()

  // Handle action messages with spinner
  if (message.type === 'action_start') {
    if (message.isActionRunning) {
      // Action is still running - show spinner
      return (
        <Text color={colors.text}>
          <Spinner type="dots" /> {message.content}
        </Text>
      )
    }

    // Action completed - show with completion message
    return (
      <Text color={colors.text}>
        {message.content}
        {message.stopMessage ? `... ${message.stopMessage}` : ''}
      </Text>
    )
  }

  // Regular messages
  let color = colors.text
  if (message.type === 'error') color = colors.errorText
  if (message.type === 'warning') color = colors.warning

  return (
    <Text color={color}>
      {message.content}
    </Text>
  )
}

export interface CommandOutputProps {
  isExpanded?: boolean
  output: StreamingMessage[]
  terminalWidth: number
}

/**
 * Renders command output (completed)
 */
export const CommandOutput: React.FC<CommandOutputProps> = ({isExpanded, output, terminalWidth}) => {
  const {theme: {colors}} = useTheme()
  const processedOutput = processMessagesForActions(output)
  const outputLimit = isExpanded ? Number.MAX_SAFE_INTEGER : MAX_OUTPUT_LINES
  const {displayMessages, skippedLines} = getMessagesFromEnd(processedOutput, outputLimit, terminalWidth)

  return (
    <Box
      borderColor={isExpanded ? undefined : colors.border}
      borderStyle={isExpanded ? undefined : 'single'}
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {skippedLines > 0 && (
        <Text color={colors.dimText}>
          ↑ {skippedLines} more lines above
        </Text>
      )}
      {displayMessages.map((streamMsg) => (
        <StreamingMessageItem key={streamMsg.id} message={streamMsg} />
      ))}
    </Box>
  )
}
