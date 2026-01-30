/**
 * Command View
 *
 * Main view with slash command input and streaming output support.
 * Uses ScrollList for message history with automatic height measurement.
 */

import {Box, Spacer, Text, useApp, useInput, useStdout} from 'ink'
import {ScrollList, ScrollListRef} from 'ink-scroll-list'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import type {CommandMessage, PromptRequest, StreamingMessage} from '../types.js'

import {ExpandedMessageView} from '../components/execution/index.js'
import {MessageItem, Suggestions} from '../components/index.js'
import {
  InlineConfirm,
  InlineFileSelector,
  InlineInput,
  InlineSearch,
  InlineSelect,
} from '../components/inline-prompts/index.js'
import {useAuth, useTasks, useTransport} from '../contexts/index.js'
import {useCommands, useMode, useTerminalBreakpoint, useTheme, useUIHeights} from '../hooks/index.js'
import {getVisualLineCount} from '../utils/line.js'

/**
 * Maximum number of output lines to display in list view before truncation
 */
const MAX_OUTPUT_LINES = 4

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

  return { content: truncatedLines.join('\n'), usedLines }
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
      const { content, usedLines: truncatedLines } = truncateMessageFromEnd(msg, availableLines, terminalWidth)
      displayMessages.unshift({ ...msg, content })
      usedLines += truncatedLines
      break
    }
  }

  // Fallback: show at least last line of last message
  if (displayMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages.at(-1)!
    const lastLine = lastMsg.content.split('\n').at(-1) ?? ''
    displayMessages.push({ ...lastMsg, content: lastLine })
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
  const {client} = useTransport()
  const {clearTasks} = useTasks()
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [expandedMessageIndex, setExpandedMessageIndex] = useState<null | number>(null)
  const {
    theme: {colors},
  } = useTheme()
  const {commandInput} = useUIHeights()
  const {breakpoint, columns: terminalWidth} = useTerminalBreakpoint()
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(0)
  const scrollListRef = useRef<ScrollListRef>(null)
  const {stdout} = useStdout()
  const ctrlOPressedRef = useRef(false)
  const previousCommandRef = useRef('')

  // Calculate expanded message early for use in hooks
  const expandedMessage = expandedMessageIndex === null ? null : messages[expandedMessageIndex]

  // Process streaming messages to handle action_start/action_stop pairs
  const processedStreamingMessages = useMemo(() => processMessagesForActions(streamingMessages), [streamingMessages])
  const {handleSlashCommand} = useCommands()
  const {appendShortcuts, mode, removeShortcuts} = useMode()

  // Filter out "o" character when Ctrl+O is pressed
  useEffect(() => {
    if (ctrlOPressedRef.current) {
      // Check if "o" was just added to the end
      if (command === previousCommandRef.current + 'o') {
        setCommand(previousCommandRef.current)
      }

      ctrlOPressedRef.current = false
    }
  }, [command])

  // Append shortcuts for prompts
  useEffect(() => {
    if (activePrompt?.type === 'search' || activePrompt?.type === 'select') {
      appendShortcuts([{ description: 'select', key: 'enter' }])

      return () => {
        removeShortcuts(['enter'])
      }
    }
  }, [activePrompt?.type, appendShortcuts, removeShortcuts])

  useEffect(() => {
    const handleResize = () => {
      scrollListRef.current?.remeasure()
    }

    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  useEffect(() => {
    if (messages.length === 0) return
    setSelectedMessageIndex(messages.length - 1)
  }, [messages.length])

  /* eslint-disable complexity -- Command execution requires handling multiple command types and states */
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
              updated[lastIndex] = { ...updated[lastIndex], output: collectedMessages }
            }

            return updated
          })
          setStreamingMessages([])
          setIsStreaming(false)
          setActivePrompt(null)
          const needReloadAuth = trimmed.startsWith('/login') || trimmed.startsWith('/logout')
          const needReloadBrvConfig = trimmed.startsWith('/space switch') || trimmed.startsWith('/init')
          const needProviderReload = trimmed.startsWith('/provider') || trimmed.startsWith('/model')
          const needNewSession = trimmed.startsWith('/new')

          // Handle /new command - create new session and clear messages
          if (needNewSession && client) {
            try {
              const response = await client.requestWithAck<{ error?: string; sessionId?: string; success: boolean }>(
                'agent:newSession',
                { reason: 'User requested new session' },
              )

              /* eslint-disable max-depth -- UI state handling requires this nesting level */
              if (response.success) {
                // Clear the messages to start fresh
                setMessages([])
                clearTasks()
              }
            } catch {
              // Error handling - the command already showed feedback
            }
            /* eslint-enable max-depth */
          }

          // Refresh state after commands that change auth or project state
          if (needReloadAuth || needReloadBrvConfig || needProviderReload) {
            clearTasks()

            if (needReloadAuth) await reloadAuth()
            if (needReloadBrvConfig) await reloadBrvConfig()

            // Restart agent with appropriate reason
            if (client) {
              const reasonMap: Record<string, string> = {
                '/init': 'Project initialized',
                '/login': 'User logged in',
                '/logout': 'User logged out',
                '/model': 'Model changed',
                '/provider': 'Provider changed',
                '/space switch': 'Space switched',
              }

              const reason = Object.entries(reasonMap).find(([cmd]) => trimmed.startsWith(cmd))?.[1] ?? 'Command executed'

              await client.requestWithAck('agent:restart', { reason })
            }
          }
        }
      }
    },
    [clearTasks, client, exit, handleSlashCommand, reloadAuth, reloadBrvConfig],
  )
  /* eslint-enable complexity */

  const handleSubmit = useCallback(
    async (value: string) => {
      if (mode === 'console' && !isStreaming) {
        await executeCommand(value)
      }
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
    (value: null | { isDirectory: boolean; name: string; path: string }) => {
      if (activePrompt?.type === 'file_selector') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        // Store current command before "o" gets inserted
        previousCommandRef.current = command
        ctrlOPressedRef.current = true

        if (expandedMessageIndex === selectedMessageIndex) {
          setExpandedMessageIndex(null)
        } else {
          setExpandedMessageIndex(selectedMessageIndex)
        }
      }

      if (key.upArrow) {
        setSelectedMessageIndex((prev) => Math.max(0, prev - 1))
      }

      if (key.downArrow) {
        setSelectedMessageIndex((prev) => Math.min(prev + 1, messages.length - 1))
      }
    },
    {isActive: mode === 'console' && !activePrompt && !expandedMessage && messages.length > 0}
  )

  // Calculate available height for scrollable content
  const scrollableHeight = Math.max(1, availableHeight - commandInput)

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
    (msg: CommandMessage, index: number, isExpanded = false) => {
      if (msg.type === 'command') {
        const hasOutput = msg.output && msg.output.length > 0
        const isLastMessage = index === messages.length - 1
        const showLiveOutput =
          isLastMessage && (isStreaming || activePrompt) && (streamingMessages.length > 0 || activePrompt)
        const contentWidth = terminalWidth - 12
        const isSelected = index === selectedMessageIndex

        return (
          <Box
            flexDirection="column"
            marginBottom={1}
            width="100%"
          >
            <Box
              borderBottom={false}
              borderLeftColor={colors.primary}
              borderRight={false}
              borderStyle="single"
              borderTop={false}
              marginBottom={isExpanded ? 1 : undefined}
              paddingLeft={1}
            >
              <Text color={colors.text} dimColor>
                {msg.fromCommand}{' '}
                {isSelected && !isExpanded && (
                  <Text dimColor italic>
                    ← [ctrl+o] to {isExpanded ? 'collapse' : 'expand'}
                  </Text>
                )}
                <Text wrap="truncate-end">{msg.content}</Text>
              </Text>
            </Box>
            {/* Command output (completed) */}
            {hasOutput &&
              (() => {
                const processedOutput = processMessagesForActions(msg.output!)
                const outputLimit = isExpanded ? Number.MAX_SAFE_INTEGER : MAX_OUTPUT_LINES
                const {displayMessages, skippedLines} = getMessagesFromEnd(processedOutput, outputLimit, contentWidth)

                return (
                  <Box
                    borderColor={isExpanded ? undefined : colors.border}
                    borderStyle={isExpanded ? undefined : 'single'}
                    flexDirection="column"
                    paddingX={1}
                    width="100%"
                  >
                    {skippedLines > 0 && !isExpanded && (
                      <Text color={colors.dimText} dimColor>
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
                const liveOutputLimit = isExpanded ? Number.MAX_SAFE_INTEGER : MAX_OUTPUT_LINES
                const { displayMessages: liveMessages, skippedLines } = getMessagesFromEnd(
                  processedStreamingMessages,
                  liveOutputLimit,
                  contentWidth,
                )
                return (
                  <Box
                    borderColor={isExpanded ? undefined : colors.border}
                    borderStyle={isExpanded ? undefined : 'single'}
                    flexDirection="column"
                    paddingX={1}
                    paddingY={0}
                    width="100%"
                  >
                    {/* Show skipped lines indicator at the top */}
                    {skippedLines > 0 && (
                      <Text color={colors.dimText} dimColor>
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
      expandedMessageIndex,
      isStreaming,
      MAX_OUTPUT_LINES,
      messages.length,
      processedStreamingMessages,
      renderActivePrompt,
      renderStreamingMessage,
      selectedMessageIndex,
      terminalWidth,
    ],
  )

  const keyExtractor = useCallback(
    (_msg: CommandMessage, index: number) => {
      const isSelected = index === selectedMessageIndex
      const isExpanded = index === expandedMessageIndex
      return `msg-${index}-${isSelected}-${isExpanded}`
    },
    [expandedMessageIndex, selectedMessageIndex],
  )

  if (expandedMessage) {
    return (
      <ExpandedMessageView
        availableHeight={availableHeight}
        isActive={mode === 'console'}
        message={expandedMessage}
        messageIndex={expandedMessageIndex!}
        onClose={() => setExpandedMessageIndex(null)}
        renderMessageItem={renderMessageItem}
      />
    )
  }

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* Messages - Scrollable area */}
      {messages.length > 0 ? (
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          <ScrollList
            height={scrollableHeight}
            ref={scrollListRef}
            scrollAlignment="auto"
            selectedIndex={selectedMessageIndex}
          >
            {messages.map((msg, index) => (
              <Box key={keyExtractor(msg, index)}>
                {renderMessageItem(msg, index, false)}
              </Box>
            ))}
          </ScrollList>
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
            placeholder={isStreaming ? 'Processing...' : 'Use / to view commands'}
            value={command}
          />
        </Box>
      </Box>
    </Box>
  )
}
