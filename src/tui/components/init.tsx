/**
 * Init Component
 *
 * Reusable component for running the /init command with streaming output
 * and inline prompts. Used by InitView and OnboardingFlow.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {PromptRequest, StreamingMessage} from '../types.js'

import {useAuth, useTransport} from '../contexts/index.js'
import {useCommands, useTheme} from '../hooks/index.js'
import {EnterPrompt} from './enter-prompt.js'
import {InlineConfirm, InlineInput, InlineSearch, InlineSelect} from './inline-prompts/index.js'

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
 * Count the total number of lines in streaming messages (simple newline count)
 *
 * @param messages - Array of streaming messages
 * @returns Total number of lines across all messages
 */
function countOutputLines(messages: StreamingMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += msg.content.split('\n').length
  }

  return total
}

/**
 * Get messages from the end that fit within maxLines, truncating from the beginning
 *
 * @param messages - Array of streaming messages
 * @param maxLines - Maximum number of lines to display
 * @returns Object containing display messages, skipped lines count, and total lines
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
      displayMessages.unshift(msg)
      lineCount += msgLineCount
    } else {
      const remainingSpace = maxLines - lineCount
      if (remainingSpace > 0) {
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

  return {
    displayMessages,
    skippedLines: totalLines - lineCount,
    totalLines,
  }
}

/**
 * Process streaming messages to handle action_start/action_stop pairs
 * Matches action_start messages with their corresponding action_stop messages
 *
 * @param messages - Array of streaming messages
 * @returns Processed messages with action state included
 */
function processMessagesForActions(messages: StreamingMessage[]): ProcessedMessage[] {
  const stopMessages = new Map<string, string>()
  for (const msg of messages) {
    if (msg.type === 'action_stop' && msg.actionId) {
      stopMessages.set(msg.actionId, msg.content)
    }
  }

  const result: ProcessedMessage[] = []
  for (const msg of messages) {
    if (msg.type === 'action_stop') {
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

/** Minimum visible items for inline search */
const MIN_SEARCH_ITEMS = 3

/** Reserved lines for inline search (message + input + margins) */
const INLINE_SEARCH_OVERHEAD = 3

export interface InitProps {
  /** Whether the component should be interactive (for EnterPrompt activation) */
  active?: boolean

  /** Auto-start init without waiting for Enter key in idle state */
  autoStart?: boolean

  /** Custom idle state message (optional) */
  idleMessage?: string

  /** Maximum lines available for streaming output */
  maxOutputLines: number

  /** Optional callback when init completes successfully */
  onInitComplete?: () => void

  /** Show idle state message? (default: true for InitView, false for OnboardingFlow) */
  showIdleMessage?: boolean
}

export const Init: React.FC<InitProps> = ({
  active = true,
  autoStart = false,
  idleMessage = 'Your project needs initializing.',
  maxOutputLines,
  onInitComplete,
  showIdleMessage = true,
}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {reloadAuth} = useAuth()
  const {client} = useTransport()
  const {handleSlashCommand} = useCommands()

  const maxSearchItems = Math.max(MIN_SEARCH_ITEMS, maxOutputLines - INLINE_SEARCH_OVERHEAD)

  // Streaming state for init command
  const [isRunningInit, setIsRunningInit] = useState(false)
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [initError, setInitError] = useState<null | string>(null)

  // Handle init command execution
  const runInit = useCallback(async () => {
    if (isRunningInit) return

    setIsRunningInit(true)
    setStreamingMessages([])
    setInitError(null)

    const result = await handleSlashCommand('/init')

    if (result && result.type === 'streaming') {
      const onMessage = (msg: StreamingMessage) => {
        setStreamingMessages((prev) => [...prev, msg])
        setInitError(msg.type === 'error' ? msg.content : null)
      }

      const onPrompt = (prompt: PromptRequest) => {
        setActivePrompt(prompt)
      }

      try {
        await result.execute(onMessage, onPrompt)

        // Reload auth to detect config change
        await reloadAuth()

        // Restart agent to pick up new project state
        if (client) {
          await client.request('agent:restart', {reason: 'Project initialized'})
        }

        // Call completion callback if provided
        if (onInitComplete) {
          onInitComplete()
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        setInitError(errorMessage)
      } finally {
        setIsRunningInit(false)
        setActivePrompt(null)
      }
    } else if (result && result.type === 'message') {
      setInitError(result.content)
      setIsRunningInit(false)
    }
  }, [handleSlashCommand, isRunningInit, reloadAuth, client, onInitComplete])

  // Auto-start init if autoStart is true and component is in idle state
  useEffect(() => {
    if (autoStart && !isRunningInit && !initError) {
      runInit()
    }
  }, [autoStart, isRunningInit, initError, runInit])

  // Process streaming messages to handle action_start/action_stop pairs
  const processedStreamingMessages = useMemo(() => processMessagesForActions(streamingMessages), [streamingMessages])

  // Render streaming message with proper styling
  const renderStreamingMessage = useCallback(
    (msg: ProcessedMessage) => {
      // Handle action messages with spinner
      if (msg.type === 'action_start') {
        if (msg.isActionRunning) {
          return (
            <Text color={colors.text} key={msg.id}>
              <Spinner type="dots" /> {msg.content}
            </Text>
          )
        }

        return (
          <Text color={colors.text} key={msg.id}>
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

  // Prompt response handlers
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

  // Render active prompt
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
          <InlineSearch
            maxVisibleItems={maxSearchItems}
            message={activePrompt.message}
            onSelect={handleSearchResponse}
            source={activePrompt.source}
          />
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
    handleInputResponse,
    handleSearchResponse,
    handleSelectResponse,
    maxSearchItems,
  ])

  // Running state - show streaming output
  if (isRunningInit) {
    const {displayMessages} = getMessagesFromEnd(
      processedStreamingMessages,
      maxOutputLines,
    )

    return (
      <Box flexDirection="column" width="100%">
        {/* Live streaming output */}
        <Box
          borderColor={colors.border}
          borderStyle="single"
          flexDirection="column"
          paddingX={1}
          paddingY={0}
          width="100%"
        >
          {displayMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
          {/* Active prompt */}
          {renderActivePrompt()}
        </Box>
      </Box>
    )
  }

  // Error state - show error with retry
  if (initError) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text color={colors.errorText}>Error: {initError}</Text>
        <EnterPrompt
          action="try again"
          active={active && !isRunningInit && !activePrompt}
          onEnter={runInit}
        />
      </Box>
    )
  }
  
  if (autoStart) {
    return null
  }

  return (
    <Box flexDirection="column" rowGap={1}>
      {showIdleMessage && <Text color={colors.text}>{idleMessage}</Text>}
      <EnterPrompt
        action="initialize your project"
        active={active && !isRunningInit && !activePrompt}
        onEnter={runInit}
      />
    </Box>
  )
}
