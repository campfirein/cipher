/**
 * Command View
 *
 * Main view with slash command input and streaming output support.
 * Uses ScrollableList for message history with dynamic height calculation.
 */

import {Box, Spacer, Text, useApp} from 'ink'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'
import {randomUUID} from 'node:crypto'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {StreamingEvent} from '../../core/domain/cipher/streaming/types.js'
import type {CommandMessage, PromptRequest, StreamingMessage} from '../types.js'

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
import {useChat} from '../contexts/chat-context.js'
import {useConsumer} from '../contexts/index.js'
import {useCommands, useMode, useTerminalBreakpoint, useTheme, useUIHeights} from '../hooks/index.js'
import {getVisualLineCount} from '../utils/line.js'

/** Max visible items in InlineSearch */
const INLINE_SEARCH_MAX_ITEMS = 7

/**
 * Map streaming events from CipherAgent to StreamingMessage for display
 */
function mapEventToStreamingMessage(event: StreamingEvent): null | StreamingMessage {
  switch (event.name) {
    case 'llmservice:chunk': {
      if (event.type === 'text') {
        return {content: event.content, id: randomUUID(), type: 'output'}
      }

      return null
    }

    case 'llmservice:error': {
      return {content: event.error, id: randomUUID(), type: 'error'}
    }

    case 'llmservice:response': {
      // Final response - always display it since llmservice:chunk events
      // are not emitted by the current LLM service implementation
      if (event.content) {
        return {content: event.content, id: randomUUID(), type: 'output'}
      }

      return null
    }

    case 'llmservice:toolCall': {
      return {
        actionId: event.callId,
        content: `Calling ${event.toolName}...`,
        id: randomUUID(),
        type: 'action_start',
      }
    }

    case 'llmservice:toolResult': {
      return {
        actionId: event.callId,
        content: event.success ? 'done' : 'failed',
        id: randomUUID(),
        type: 'action_stop',
      }
    }

    case 'llmservice:warning': {
      return {content: event.message, id: randomUUID(), type: 'warning'}
    }

    default: {
      return null
    }
  }
}

/**
 * Calculate visual line count for a message
 */
function getMessageVisualLineCount(message: StreamingMessage, terminalWidth: number): number {
  return message.content
    .split('\n')
    .reduce((total, line) => total + getVisualLineCount(line, terminalWidth), 0)
}

/**
 * Count total visual lines across all messages
 */
function countOutputLines(messages: StreamingMessage[], terminalWidth: number): number {
  return messages.reduce((total, msg) => total + getMessageVisualLineCount(msg, terminalWidth), 0)
}

/**
 * Truncate message content from the end to fit within available visual lines
 */
function truncateMessageFromEnd(
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
function getMessagesFromEnd(
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
  terminalWidth: number
}

/**
 * Estimate the line height of a command message
 */
function estimateMessageHeight(msg: CommandMessage, options: MessageHeightOptions): number {
  const {isLast = false, maxOutputLines, promptHeight = 0, streamingLines = 0, terminalWidth} = options
  let lines = 0

  if (msg.type === 'command') {
    // Command header with left border
    lines += 1

    // Output box if present (completed output)
    if (msg.output && msg.output.length > 0) {
      // Count actual lines in the output (each message can have multiple lines)
      const totalOutputLines = countOutputLines(msg.output, terminalWidth)
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

/**
 * Props for CommandView component
 *
 * Calculated as: `Math.max(1, terminalHeight - header - tab - footer)`
 * This represents the remaining terminal space after accounting for all UI chrome
 * (header, tab bar, and footer), ensuring at least 1 line is always available.
 */
interface CommandViewProps {
  availableHeight: number
}

export const CommandView: React.FC<CommandViewProps> = ({availableHeight}) => {
  const {exit} = useApp()
  const {reloadAuth, reloadBrvConfig} = useAuth()
  const {restart} = useConsumer()
  const {enterChatMode, exitChatMode, isInChatMode, isProcessing: isChatProcessing, sendMessage} = useChat()
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const {
    theme: {colors},
  } = useTheme()
  const {commandInput} = useUIHeights()
  const {breakpoint, columns: terminalWidth} = useTerminalBreakpoint()

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

      // Handle enter chat mode
      if (result && result.type === 'enter_chat_mode') {
        try {
          await enterChatMode()
          setMessages((prev) => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
              updated[lastIndex] = {
                ...updated[lastIndex],
                output: [{content: 'Entered chat mode. Type your message or /exit to leave.', id: 'chat-enter', type: 'output'}],
              }
            }

            return updated
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          setMessages((prev) => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
              updated[lastIndex] = {
                ...updated[lastIndex],
                output: [{content: `Failed to enter chat mode: ${errorMessage}`, id: 'chat-error', type: 'error'}],
              }
            }

            return updated
          })
        }

        return
      }

      // Handle exit chat mode
      if (result && result.type === 'exit_chat_mode') {
        exitChatMode()
        setMessages((prev) => {
          const updated = [...prev]
          const lastIndex = updated.length - 1
          if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
            updated[lastIndex] = {
              ...updated[lastIndex],
              output: [{content: 'Exited chat mode.', id: 'chat-exit', type: 'output'}],
            }
          }

          return updated
        })
        return
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
          const needReloadAuth = trimmed.startsWith('/login') || trimmed.startsWith('/logout')
          const needReloadBrvConfig = trimmed.startsWith('/space switch') || trimmed.startsWith('/init')

          // Refresh state after commands that change auth or project state
          if (needReloadAuth || needReloadBrvConfig) {
            if (needReloadAuth) await reloadAuth()
            if (needReloadBrvConfig) await reloadBrvConfig()
            // restart() handles stop + cleanup + start
            await restart()
          }
        }
      }
    },
    [enterChatMode, exit, exitChatMode, handleSlashCommand, reloadAuth, reloadBrvConfig, restart],
  )

  /**
   * Handle chat message - send to Cipher agent and stream response
   */
  const handleChatMessage = useCallback(
    async (input: string) => {
      const trimmed = input.trim()
      if (!trimmed) return

      // Clear command input immediately
      setCommand('')

      // Add user message to display
      setMessages((prev) => [
        ...prev,
        {
          content: '',
          fromCommand: trimmed,
          type: 'command',
        },
      ])

      setIsStreaming(true)
      setStreamingMessages([])

      const collectedMessages: StreamingMessage[] = []

      try {
        const iterator = await sendMessage(trimmed)

        for await (const event of iterator) {
          const msg = mapEventToStreamingMessage(event)
          if (msg) {
            collectedMessages.push(msg)
            setStreamingMessages((prev) => [...prev, msg])
          }
        }
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
        // Store output with the message
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
      }
    },
    [sendMessage],
  )

  const handleSubmit = useCallback(
    async (value: string) => {
      if (mode === 'console' && !isStreaming && !isChatProcessing) {
        // In chat mode, route non-slash input to chat handler
        await (isInChatMode && !value.trim().startsWith('/') ? handleChatMessage(value) : executeCommand(value));
      }
    },
    [executeCommand, handleChatMessage, isChatProcessing, isInChatMode, isStreaming, mode],
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
  const scrollableHeight = Math.max(1, availableHeight - commandInput)
  // Subtract input + border + indicator lines + indicator page (1 + 2 + 1 + 2)
  const maxOutputLines = scrollableHeight - 6

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
        // availableHeight - more above indicator - input - selector title - selector footer - command input
        const pageSize = availableHeight - 1 - 1 - 4 - 4 - commandInput
        return (
          <InlineFileSelector
            allowCancel={activePrompt.allowCancel}
            basePath={activePrompt.basePath}
            filter={activePrompt.filter}
            message={activePrompt.message}
            mode={activePrompt.mode}
            onSelect={handleFileSelectorResponse}
            pageSize={breakpoint === 'normal' ? pageSize : 2}
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

  const renderMessageItem = useCallback(
    (msg: CommandMessage, index: number) => {
      if (msg.type === 'command') {
        const hasOutput = msg.output && msg.output.length > 0
        const isLastMessage = index === messages.length - 1
        const showLiveOutput =
          isLastMessage && (isStreaming || activePrompt) && (streamingMessages.length > 0 || activePrompt)
        const contentWidth = terminalWidth - 12

        return (
          <Box flexDirection="column" marginBottom={1} width="100%">
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
                const {displayMessages, skippedLines} = getMessagesFromEnd(processedOutput, maxOutputLines, contentWidth)
                return (
                  <Box
                    borderColor={colors.border}
                    borderStyle="round"
                    flexDirection="column"
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
                  contentWidth,
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
                    {isStreaming && !activePrompt && liveMessages.length === 0 && (
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
        terminalWidth,
      })
    },
    [activePrompt, isStreaming, maxOutputLines, messages.length, streamingMessages.length, terminalWidth],
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
            placeholder={isStreaming || isChatProcessing ? 'Processing...' : isInChatMode ? 'Type your message...' : 'Use / to view commands'}
            value={command}
          />
        </Box>
      </Box>
    </Box>
  )
}
