/**
 * Command View
 *
 * Main view with slash command input and streaming output support.
 * Uses ScrollableList for message history with dynamic height calculation.
 */

import {Box, Spacer, Text, useApp} from 'ink'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'
import React, {useCallback, useEffect, useState} from 'react'

import type {CommandMessage, PromptRequest, StreamingMessage} from '../types.js'

import {stopQueuePollingService} from '../../infra/cipher/consumer/queue-polling-service.js'
import {MessageItem, ScrollableList, Suggestions} from '../components/index.js'
import {InlineConfirm, InlineSearch, InlineSelect} from '../components/inline-prompts/index.js'
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
 * Get messages that fit within maxLines, truncating the last message if needed
 */
function getMessagesWithinLines(
  messages: StreamingMessage[],
  maxLines: number,
): {displayMessages: StreamingMessage[]; remainingLines: number; totalLines: number} {
  const totalLines = countOutputLines(messages)

  if (totalLines <= maxLines) {
    return {displayMessages: messages, remainingLines: 0, totalLines}
  }

  const displayMessages: StreamingMessage[] = []
  let lineCount = 0

  for (const msg of messages) {
    const msgLineArray = msg.content.split('\n')
    const msgLineCount = msgLineArray.length

    if (lineCount + msgLineCount <= maxLines) {
      // Message fits completely
      displayMessages.push(msg)
      lineCount += msgLineCount
    } else {
      // Message needs to be truncated - show partial lines
      const remainingSpace = maxLines - lineCount
      if (remainingSpace > 0) {
        // Take only the lines that fit
        const truncatedContent = msgLineArray.slice(0, remainingSpace).join('\n')
        displayMessages.push({
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
    const firstLines = messages[0].content.split('\n')
    displayMessages.push({
      ...messages[0],
      content: firstLines[0],
    })
    lineCount = 1
  }

  return {
    displayMessages,
    remainingLines: totalLines - lineCount,
    totalLines,
  }
}

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
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const {
    theme: {colors},
  } = useTheme()
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

      if (result && result.type === 'clear') {
        setMessages([])
        setStreamingMessages([])
      }

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
        }
      }
    },
    [exit, handleSlashCommand],
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
    setCommand(value + ' ')
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

  // Calculate available height for scrollable content
  // Subtract bottom area (suggestions + input)
  const scrollableHeight = Math.max(1, availableHeight - BOTTOM_AREA_HEIGHT)

  // Calculate max output lines based on available height
  // Reserve space for command header, borders, hint line, and margin
  const maxOutputLines = Math.max(MIN_OUTPUT_LINES, scrollableHeight - OUTPUT_BOX_OVERHEAD)

  // Render streaming message
  const renderStreamingMessage = useCallback(
    (msg: StreamingMessage) => {
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
                const {displayMessages, remainingLines} = getMessagesWithinLines(msg.output!, maxOutputLines)
                return (
                  <Box
                    borderColor={colors.border}
                    borderStyle="round"
                    flexDirection="column"
                    marginTop={0}
                    paddingX={1}
                    width="100%"
                  >
                    {displayMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
                    {remainingLines > 0 && (
                      <Text color={colors.secondary} dimColor>
                        ↕ {remainingLines} more lines (resize terminal to view full output)
                      </Text>
                    )}
                  </Box>
                )
              })()}
            {/* Live streaming output (while running) */}
            {showLiveOutput && (
              <Box
                borderColor={colors.border}
                borderStyle="round"
                flexDirection="column"
                paddingX={1}
                paddingY={0}
                width="100%"
              >
                {streamingMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
                {/* Show spinner when processing but no output yet */}
                {isStreaming && !activePrompt && msg.fromCommand.startsWith('/query') && (
                  <Text color={colors.dimText}>
                    <Spinner type="dots" /> Processing...
                  </Text>
                )}
                {/* Active prompt */}
                {activePrompt?.type === 'search' && (
                  <InlineSearch
                    message={activePrompt.message}
                    onSelect={handleSearchResponse}
                    source={activePrompt.source}
                  />
                )}
                {activePrompt?.type === 'confirm' && (
                  <InlineConfirm
                    default={activePrompt.default}
                    message={activePrompt.message}
                    onConfirm={handleConfirmResponse}
                  />
                )}
                {activePrompt?.type === 'select' && (
                  <InlineSelect
                    choices={activePrompt.choices}
                    message={activePrompt.message}
                    onSelect={handleSelectResponse}
                  />
                )}
              </Box>
            )}
          </Box>
        )
      }

      return <MessageItem message={msg} />
    },
    [
      activePrompt,
      colors,
      handleConfirmResponse,
      handleSearchResponse,
      handleSelectResponse,
      isStreaming,
      maxOutputLines,
      messages.length,
      renderStreamingMessage,
      streamingMessages,
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
