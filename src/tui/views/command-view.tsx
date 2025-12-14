/**
 * Command View
 *
 * Main view with slash command input and streaming output support.
 * Uses ScrollableList for message history with dynamic height calculation.
 */

import {Box, Spacer, Text, useApp} from 'ink'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {CommandMessage, PromptRequest, StreamingMessage} from '../types.js'

import {stopConsumer} from '../../infra/cipher/consumer/execution-consumer.js'
import {stopQueuePollingService} from '../../infra/cipher/consumer/queue-polling-service.js'
import {MessageItem, ScrollableList, Suggestions} from '../components/index.js'
import {
  InlineConfirm,
  InlineFileSelector,
  InlineInput,
  InlineSearch,
  InlineSelect,
} from '../components/inline-prompts/index.js'
import {useAuth} from '../contexts/auth-context.js'
import {useConsumer} from '../contexts/index.js'
import {useCommands, useMode, useTheme} from '../hooks/index.js'

/** Fixed height for bottom area (suggestions + input) */
const BOTTOM_AREA_HEIGHT = 4

/** Max visible items in InlineSearch */
const INLINE_SEARCH_MAX_ITEMS = 7

/** Minimum output lines to show before truncation */
const MIN_OUTPUT_LINES = 5

/** Reserved lines for output box (command header + borders + hint line + margin) */
const OUTPUT_BOX_OVERHEAD = 5

/**
 * Count the total number of lines in streaming messages
 * Each message can contain multiple lines (newlines in content)
 */
function countOutputLines(messages: StreamingMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += msg.content.split('\n').length
  }

  return total
}

/**
 * Get messages from the end that fit within maxLines, truncating from the beginning (shows newest first)
 * Used for both completed and live streaming output to always show the latest messages
 */
function getMessagesFromEnd(
  messages: StreamingMessage[],
  maxLines: number,
): {displayMessages: StreamingMessage[]; skippedLines: number; totalLines: number} {
  const totalLines = countOutputLines(messages)

  if (totalLines <= maxLines) {
    return {displayMessages: messages, skippedLines: 0, totalLines}
  }

  const displayMessages: StreamingMessage[] = []
  let lineCount = 0

  // Iterate from the end (newest messages first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgLineArray = msg.content.split('\n')
    const msgLineCount = msgLineArray.length

    if (lineCount + msgLineCount <= maxLines) {
      // Message fits completely - prepend to maintain order
      displayMessages.unshift(msg)
      lineCount += msgLineCount
    } else {
      // Message needs to be truncated - show partial lines from the end
      const remainingSpace = maxLines - lineCount
      if (remainingSpace > 0) {
        // Take only the last lines that fit
        const truncatedContent = msgLineArray.slice(-remainingSpace).join('\n')
        displayMessages.unshift({
          ...msg,
          content: truncatedContent,
        })
        lineCount += remainingSpace
      }

      break
    }
  }

  // Ensure we show at least one line
  if (displayMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages.at(-1)!
    const lastLines = lastMsg.content.split('\n')
    displayMessages.push({
      ...lastMsg,
      content: lastLines.at(-1) ?? '',
    })
    lineCount = 1
  }

  return {
    displayMessages,
    skippedLines: totalLines - lineCount,
    totalLines,
  }
}

/**
 * Processed streaming message for rendering
 * Includes action state for spinner display
 */
interface ProcessedMessage extends StreamingMessage {
  /** For action_start: whether the action is still running (no matching action_stop) */
  isActionRunning?: boolean
  /** For action_start: the completion message from action_stop */
  stopMessage?: string
}

/**
 * Process streaming messages to handle action_start/action_stop pairs
 * - action_start with matching action_stop: mark as completed with stop message
 * - action_start without matching action_stop: mark as running (show spinner)
 * - action_stop messages are filtered out (consumed by their action_start)
 */
function processMessagesForActions(messages: StreamingMessage[]): ProcessedMessage[] {
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

/** Default page size for file selector */
const INLINE_FILE_SELECTOR_PAGE_SIZE = 7

/**
 * Estimate height of an active prompt
 */
function estimatePromptHeight(prompt: null | PromptRequest): number {
  if (!prompt) return 0

  switch (prompt.type) {
    case 'confirm': {
      // Single line: "? message (Y/n) [input]"
      return 3
    }

    case 'file_selector': {
      // Message + path + separator + items + scroll indicator + hint
      const pageSize = prompt.pageSize ?? INLINE_FILE_SELECTOR_PAGE_SIZE
      return 5 + pageSize
    }

    case 'input': {
      // Message line + optional error line
      return 3
    }

    case 'search': {
      // Message line + up to 7 visible choices (or 1 for "No results")
      // We estimate 7 since we don't know actual results
      return 3 + INLINE_SEARCH_MAX_ITEMS
    }

    case 'select': {
      // Message line + choices + optional description (with margin)
      const hasDescription = prompt.choices.some((c) => c.description)
      return 1 + prompt.choices.length + (hasDescription ? 2 : 0)
    }

    default: {
      return 4
    }
  }
}

interface MessageHeightOptions {
  isLast?: boolean
  maxOutputLines: number
  promptHeight?: number
  streamingLines?: number
}

/**
 * Estimate the line height of a command message
 */
function estimateMessageHeight(msg: CommandMessage, options: MessageHeightOptions): number {
  const {isLast = false, maxOutputLines, promptHeight = 0, streamingLines = 0} = options
  let lines = 0

  if (msg.type === 'command') {
    // Command header with left border
    lines += 1

    // Output box if present (completed output)
    if (msg.output && msg.output.length > 0) {
      // Count actual lines in the output (each message can have multiple lines)
      const totalOutputLines = countOutputLines(msg.output)
      // Account for truncation: show max lines + 1 for hint
      const displayedLines = totalOutputLines <= maxOutputLines ? totalOutputLines : maxOutputLines + 1
      // Border top + content + border bottom
      lines += 2 + displayedLines
    }

    // Live streaming output box (for last message while streaming)
    if (isLast && (streamingLines > 0 || promptHeight > 0)) {
      // Border top + streaming content + prompt + border bottom
      lines += 2 + streamingLines + promptHeight
    }

    // Top margin for non-first items
    lines += 1
  } else {
    // Other message types (info, error, etc)
    lines += 2
  }

  return lines
}

interface CommandViewProps {
  availableHeight: number
}

export const CommandView: React.FC<CommandViewProps> = ({availableHeight}) => {
  const {exit} = useApp()
  const {reloadAuth} = useAuth()
  const {restart} = useConsumer()
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const {
    theme: {colors},
  } = useTheme()

  // Process streaming messages to handle action_start/action_stop pairs
  const processedStreamingMessages = useMemo(() => processMessagesForActions(streamingMessages), [streamingMessages])
  const {handleSlashCommand} = useCommands()
  const {appendShortcuts, mode, removeShortcuts} = useMode()

  // Append shortcuts for prompts
  useEffect(() => {
    if (activePrompt?.type === 'search' || activePrompt?.type === 'select') {
      appendShortcuts([{description: 'select', key: 'enter'}])

      return () => {
        removeShortcuts(['enter'])
      }
    }
  }, [activePrompt?.type, appendShortcuts, removeShortcuts])

  const executeCommand = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      // Clear command input immediately
      setCommand('')
      setMessages((prev) => [
        ...prev,
        {
          content: '',
          fromCommand: trimmed,
          type: 'command',
        },
      ])

      const result = await handleSlashCommand(trimmed)

      if (result && result.type === 'message') {
        setMessages((prev) => {
          const last = prev.at(-1)

          return [
            ...(last?.type === 'command' ? prev.slice(0, -1) : [...prev]),
            {
              content: result.content,
              fromCommand: trimmed,
              type: result.messageType === 'error' ? 'error' : 'info',
            },
          ]
        })
      }

      if (result && result.type === 'quit') {
        stopQueuePollingService()
        exit()
      }

      if (result && result.type === 'streaming') {
        setIsStreaming(true)
        setStreamingMessages([])

        const collectedMessages: StreamingMessage[] = []

        const onMessage = (msg: StreamingMessage) => {
          collectedMessages.push(msg)
          setStreamingMessages((prev) => [...prev, msg])
        }

        const onPrompt = (prompt: PromptRequest) => {
          setActivePrompt(prompt)
        }

        try {
          await result.execute(onMessage, onPrompt)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          const errorMsg: StreamingMessage = {
            content: `Error: ${errorMessage}`,
            id: `error-${Date.now()}`,
            type: 'error',
          }
          collectedMessages.push(errorMsg)
          setStreamingMessages((prev) => [...prev, errorMsg])
        } finally {
          // Store output with the command message
          setMessages((prev) => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
              updated[lastIndex] = {...updated[lastIndex], output: collectedMessages}
            }

            return updated
          })
          setStreamingMessages([])
          setIsStreaming(false)
          setActivePrompt(null)

          // Refresh state after commands that change auth or project state
          if (trimmed.startsWith('/logout') || trimmed.startsWith('/login')) {
            // Stop queue polling and consumer
            stopQueuePollingService()
            stopConsumer()
            // Wait for consumer to stop
            setTimeout(() => {
              reloadAuth()
            }, 1000)
          }

          // Restart consumer after commands that change project state
          if (
            trimmed.startsWith('/init') ||
            trimmed.startsWith('/space switch') ||
            trimmed.startsWith('/space select')
          ) {
            await reloadAuth()
            await restart()
          }
        }
      }
    },
    [exit, handleSlashCommand, reloadAuth, restart],
  )

  const handleSubmit = useCallback(
    async (value: string) => {
      if (mode === 'console' && !isStreaming) await executeCommand(value)
    },
    [executeCommand, isStreaming, mode],
  )

  const handleSelect = useCallback(
    async (value: string) => {
      if (!isStreaming) await executeCommand(value)
    },
    [executeCommand, isStreaming],
  )

  const handleInsert = useCallback((value: string) => {
    // Don't add space after directories (ends with /) to allow continued navigation
    const suffix = value.endsWith('/') ? '' : ' '
    setCommand(value + suffix)
    // TRICK: Force TextInput to remount with cursor at the end
    setInputKey((prev) => prev + 1)
  }, [])

  // Handle prompt response
  const handleSearchResponse = useCallback(
    (value: unknown) => {
      if (activePrompt?.type === 'search') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleConfirmResponse = useCallback(
    (value: boolean) => {
      if (activePrompt?.type === 'confirm') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleSelectResponse = useCallback(
    (value: unknown) => {
      if (activePrompt?.type === 'select') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleInputResponse = useCallback(
    (value: string) => {
      if (activePrompt?.type === 'input') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleFileSelectorResponse = useCallback(
    (value: null | {isDirectory: boolean; name: string; path: string}) => {
      if (activePrompt?.type === 'file_selector') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  // Calculate available height for scrollable content
  // Subtract bottom area (suggestions + input)
  const scrollableHeight = Math.max(1, availableHeight - BOTTOM_AREA_HEIGHT)

  // Calculate max output lines based on available height
  // Reserve space for command header, borders, hint line, and margin
  const maxOutputLines = Math.max(MIN_OUTPUT_LINES, scrollableHeight - OUTPUT_BOX_OVERHEAD)

  // Render streaming message (handles ProcessedMessage for action types)
  const renderStreamingMessage = useCallback(
    (msg: ProcessedMessage) => {
      // Handle action messages with spinner
      if (msg.type === 'action_start') {
        if (msg.isActionRunning) {
          // Action is still running - show spinner
          return (
            <Text color={colors.text} key={msg.id}>
              <Spinner type="dots" /> {msg.content}
            </Text>
          )
        }

        // Action completed - show with completion message
        return (
          <Text color={colors.text} key={msg.id}>
            {msg.content}
            {msg.stopMessage ? `... ${msg.stopMessage}` : ''}
          </Text>
        )
      }

      // Regular messages
      let color = colors.text
      if (msg.type === 'error') color = colors.errorText
      if (msg.type === 'warning') color = colors.warning

      return (
        <Text color={color} key={msg.id}>
          {msg.content}
        </Text>
      )
    },
    [colors],
  )

  // Render active prompt component based on type
  const renderActivePrompt = useCallback(() => {
    if (!activePrompt) return null

    switch (activePrompt.type) {
      case 'confirm': {
        return (
          <InlineConfirm
            default={activePrompt.default}
            message={activePrompt.message}
            onConfirm={handleConfirmResponse}
          />
        )
      }

      case 'file_selector': {
        return (
          <InlineFileSelector
            allowCancel={activePrompt.allowCancel}
            basePath={activePrompt.basePath}
            filter={activePrompt.filter}
            message={activePrompt.message}
            mode={activePrompt.mode}
            onSelect={handleFileSelectorResponse}
            pageSize={activePrompt.pageSize}
          />
        )
      }

      case 'input': {
        return (
          <InlineInput
            message={activePrompt.message}
            onSubmit={handleInputResponse}
            placeholder={activePrompt.placeholder}
            validate={activePrompt.validate}
          />
        )
      }

      case 'search': {
        return (
          <InlineSearch message={activePrompt.message} onSelect={handleSearchResponse} source={activePrompt.source} />
        )
      }

      case 'select': {
        return (
          <InlineSelect choices={activePrompt.choices} message={activePrompt.message} onSelect={handleSelectResponse} />
        )
      }

      default: {
        return null
      }
    }
  }, [
    activePrompt,
    handleConfirmResponse,
    handleFileSelectorResponse,
    handleInputResponse,
    handleSearchResponse,
    handleSelectResponse,
  ])

  // Render a single message item
  // For the last command message during streaming, show live streaming output
  const renderMessageItem = useCallback(
    (msg: CommandMessage, index: number) => {
      if (msg.type === 'command') {
        const hasOutput = msg.output && msg.output.length > 0
        const isLastMessage = index === messages.length - 1
        const showLiveOutput =
          isLastMessage && (isStreaming || activePrompt) && (streamingMessages.length > 0 || activePrompt)

        return (
          <Box flexDirection="column" marginTop={index === 0 ? 0 : 1} width="100%">
            <Box
              borderBottom={false}
              borderLeftColor={colors.primary}
              borderRight={false}
              borderStyle="bold"
              borderTop={false}
              paddingLeft={1}
            >
              <Text color={colors.text} dimColor>
                {msg.fromCommand} <Text wrap="truncate-end">{msg.content}</Text>
              </Text>
            </Box>
            {/* Command output (completed) */}
            {hasOutput &&
              (() => {
                const processedOutput = processMessagesForActions(msg.output!)
                const {displayMessages, skippedLines} = getMessagesFromEnd(processedOutput, maxOutputLines)
                return (
                  <Box
                    borderColor={colors.border}
                    borderStyle="round"
                    flexDirection="column"
                    marginTop={0}
                    paddingX={1}
                    width="100%"
                  >
                    {skippedLines > 0 && (
                      <Text color={colors.secondary} dimColor>
                        ↑ {skippedLines} more lines above
                      </Text>
                    )}
                    {displayMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
                  </Box>
                )
              })()}
            {/* Live streaming output (while running) */}
            {showLiveOutput &&
              (() => {
                const {displayMessages: liveMessages, skippedLines} = getMessagesFromEnd(
                  processedStreamingMessages,
                  maxOutputLines,
                )
                return (
                  <Box
                    borderColor={colors.border}
                    borderStyle="round"
                    flexDirection="column"
                    paddingX={1}
                    paddingY={0}
                    width="100%"
                  >
                    {/* Show skipped lines indicator at the top */}
                    {skippedLines > 0 && (
                      <Text color={colors.secondary} dimColor>
                        ↑ {skippedLines} more lines above
                      </Text>
                    )}
                    {liveMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
                    {/* Show spinner when processing but no output yet */}
                    {isStreaming && !activePrompt && msg.fromCommand.startsWith('/query') && (
                      <Text color={colors.dimText}>
                        <Spinner type="dots" /> Processing...
                      </Text>
                    )}
                    {/* Active prompt */}
                    {renderActivePrompt()}
                  </Box>
                )
              })()}
          </Box>
        )
      }

      return <MessageItem message={msg} />
    },
    [
      activePrompt,
      colors,
      isStreaming,
      maxOutputLines,
      messages.length,
      processedStreamingMessages,
      renderActivePrompt,
      renderStreamingMessage,
    ],
  )

  const keyExtractor = useCallback((_msg: CommandMessage, index: number) => `msg-${index}`, [])

  // Height estimator that accounts for live streaming output and prompts
  const heightEstimator = useCallback(
    (msg: CommandMessage, index: number) => {
      const isLast = index === messages.length - 1
      const isLive = isLast && (isStreaming || activePrompt)
      return estimateMessageHeight(msg, {
        isLast,
        maxOutputLines,
        promptHeight: isLive ? estimatePromptHeight(activePrompt) : 0,
        streamingLines: isLive ? streamingMessages.length : 0,
      })
    },
    [activePrompt, isStreaming, maxOutputLines, messages.length, streamingMessages.length],
  )

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* Messages - Scrollable area (includes live streaming output) */}
      {messages.length > 0 ? (
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          <ScrollableList
            autoScrollToBottom
            availableHeight={scrollableHeight}
            estimateItemHeight={heightEstimator}
            isActive={mode === 'console' && !activePrompt && !isStreaming}
            items={messages}
            keyExtractor={keyExtractor}
            renderItem={renderMessageItem}
          />
        </Box>
      ) : (
        <Spacer />
      )}

      {/* Fixed bottom area: Suggestions + Input */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Suggestions - hide during streaming */}
        {!isStreaming && !activePrompt && (
          <Suggestions input={command} onInsert={handleInsert} onSelect={handleSelect} />
        )}

        {/* Command input */}
        <Box borderColor={colors.border} borderLeft={false} borderRight={false} borderStyle="single" paddingX={2}>
          <Text color={colors.primary}>{'> '}</Text>
          <TextInput
            focus={!activePrompt && (mode === 'console' || mode === 'suggestions')}
            key={inputKey}
            onChange={setCommand}
            onSubmit={handleSubmit}
            placeholder={isStreaming ? 'Command running...' : 'Use / to view commands'}
            value={command}
          />
        </Box>
      </Box>
    </Box>
  )
}
