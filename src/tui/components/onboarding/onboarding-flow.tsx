/**
 * Onboarding Flow Component
 *
 * Main container for the onboarding flow.
 * Handles step transitions and init command execution.
 */

import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useMemo, useState} from 'react'

import type {PromptRequest, StreamingMessage} from '../../types.js'

import {useAuth} from '../../contexts/auth-context.js'
import {useConsumer} from '../../contexts/index.js'
import {useActivityLogs, useCommands, useMode, useTheme} from '../../hooks/index.js'
import {useOnboarding} from '../../hooks/use-onboarding.js'
import {EnterPrompt} from '../enter-prompt.js'
import {LogItem} from '../execution/index.js'
import {InlineConfirm, InlineInput, InlineSearch, InlineSelect} from '../inline-prompts/index.js'
import {CopyablePrompt} from './copyable-prompt.js'
import {OnboardingStep} from './onboarding-step.js'

/** Example prompts for curate and query steps */
const CURATE_PROMPT = 'brv curate "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies"'
const QUERY_PROMPT = 'brv query "How is authentication implemented?"'

/** Minimum output lines to show before truncation */
const MIN_OUTPUT_LINES = 3

/** Reserved lines for onboarding step (title + description + borders + margins + onboard title + onboard description + content margin top) */
const ONBOARDING_STEP_OVERHEAD = 8

/** Reserved lines for onboarding curate/query (content margin bottom + 1 line + prompt 'enter' to continue) */
const ONBOARDING_CURATE_QUERY_OVER_BOTTOM = 3

/** Reserved lines for inline search (message + input + margins) */
const INLINE_SEARCH_OVERHEAD = 3

/** Minimum visible items for inline search */
const MIN_SEARCH_ITEMS = 3

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
 * Count the total number of lines in streaming messages
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

/** Get step number for display */
function getStepNumber(step: string): number {
  switch (step) {
    case 'curate': {
      return 2
    }

    case 'init': {
      return 1
    }

    case 'query': {
      return 3
    }

    default: {
      return 3
    }
  }
}

interface OnboardingFlowProps {
  /** Available height for the onboarding flow */
  availableHeight: number
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({availableHeight}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode} = useMode()
  const {reloadAuth} = useAuth()
  const {restart} = useConsumer()
  const {handleSlashCommand} = useCommands()
  const {
    completeOnboarding,
    curateAcknowledged,
    currentStep,
    hasCurated,
    hasQueried,
    queryAcknowledged,
    setCurateAcknowledged,
    setQueryAcknowledged,
    totalSteps,
  } = useOnboarding()
  const {logs} = useActivityLogs()

  // Calculate max output lines based on available height
  // Reserve space for onboarding step title, description, borders, and margins
  const maxOutputLines = Math.max(
    MIN_OUTPUT_LINES,
    availableHeight - ONBOARDING_STEP_OVERHEAD - ONBOARDING_CURATE_QUERY_OVER_BOTTOM,
  )

  // Calculate max visible items for inline search based on available height
  const maxSearchItems = Math.max(MIN_SEARCH_ITEMS, maxOutputLines - INLINE_SEARCH_OVERHEAD)

  // Find running or queued curate/query logs
  const curateLog = useMemo(() => logs.find((log) => log.type === 'curate'), [logs])
  const queryLog = useMemo(() => logs.find((log) => log.type === 'query'), [logs])

  // Streaming state for init command
  const [isRunningInit, setIsRunningInit] = useState(false)
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [initError, setInitError] = useState<null | string>(null)

  // Determine if we're in a skippable waiting state (curate/query without active log)
  const isInWaitingState =
    mode === 'activity' && ((currentStep === 'curate' && !curateLog) || (currentStep === 'query' && !queryLog))

  // Handle escape key to skip onboarding
  useInput(
    (_input, key) => {
      if (key.escape) {
        completeOnboarding(true) // Pass true to indicate skipped
      }
    },
    {isActive: isInWaitingState},
  )

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
        // Restart consumer to pick up new project state
        await restart()
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
  }, [handleSlashCommand, isRunningInit, reloadAuth, restart])

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

  const handleFileSelectorResponse = useCallback(
    (value: null | {isDirectory: boolean; name: string; path: string}) => {
      if (activePrompt?.type === 'file_selector') {
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
    handleFileSelectorResponse,
    handleInputResponse,
    handleSearchResponse,
    handleSelectResponse,
  ])

  // Render init step content
  const renderInitContent = () => {
    if (isRunningInit) {
      const {displayMessages: liveMessages, skippedLines} = getMessagesFromEnd(
        processedStreamingMessages,
        maxOutputLines,
      )

      return (
        <Box flexDirection="column" width="100%">
          {/* Live streaming output */}
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
            {/* Active prompt */}
            {renderActivePrompt()}
          </Box>
        </Box>
      )
    }

    if (initError) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text color={colors.errorText}>Error: {initError}</Text>
          <EnterPrompt
            action="try again"
            active={mode === 'activity' && currentStep === 'init' && !isRunningInit && !activePrompt}
            onEnter={runInit}
          />
        </Box>
      )
    }

    return (
      <EnterPrompt
        action="initialize your project"
        active={mode === 'activity' && currentStep === 'init' && !isRunningInit && !activePrompt}
        onEnter={runInit}
      />
    )
  }

  // Render curate step content
  const renderCurateContent = () => {
    // Show execution progress if curate is running
    if (curateLog) {
      return (
        <Box flexDirection="column" width="100%">
          <LogItem log={curateLog} maxContentLines={maxOutputLines} />
          {/* Waiting for Enter to continue */}
          {hasCurated && !curateAcknowledged && (
            <EnterPrompt
              action="continue"
              active={mode === 'activity' && currentStep === 'curate'}
              onEnter={() => setCurateAcknowledged(true)}
            />
          )}
        </Box>
      )
    }

    // Show copyable prompt when waiting
    return (
      <Box flexDirection="column">
        <Text color={colors.dimText} wrap="wrap">
          Copy this command and paste it to your AI agent:
        </Text>
        <CopyablePrompt isActive={mode === 'activity' && currentStep === 'curate'} prompt={CURATE_PROMPT} />
        <Box marginTop={1}>
          <Text color={colors.dimText}>
            <Spinner type="dots" /> Waiting for curate...
          </Text>
          <Text color={colors.dimText}> (Press Esc to skip)</Text>
        </Box>
      </Box>
    )
  }

  // Render query step content
  const renderQueryContent = () => {
    // Show execution progress if query is running
    if (queryLog) {
      return (
        <Box flexDirection="column" width="100%">
          <LogItem log={queryLog} maxContentLines={maxOutputLines} />
          {/* Waiting for Enter to continue */}
          {hasQueried && !queryAcknowledged && (
            <EnterPrompt
              action="continue"
              active={mode === 'activity' && currentStep === 'query'}
              onEnter={() => setQueryAcknowledged(true)}
            />
          )}
        </Box>
      )
    }

    // Show copyable prompt when waiting
    return (
      <Box flexDirection="column">
        <Text color={colors.dimText} wrap="wrap">
          Copy this command and paste it to your AI agent:
        </Text>
        <CopyablePrompt isActive={mode === 'activity' && currentStep === 'query'} prompt={QUERY_PROMPT} />
        <Box marginTop={1}>
          <Text color={colors.dimText}>
            <Spinner type="dots" /> Waiting for query...
          </Text>
          <Text color={colors.dimText}> (Press Esc to skip)</Text>
        </Box>
      </Box>
    )
  }

  // Render complete step content
  const renderCompleteContent = () => (
    <Box flexDirection="column">
      <Text color={colors.dimText} wrap="wrap">
        Activity logs will appear here as you use brv curate and brv query.
      </Text>
      <Box flexDirection="column" marginY={1}>
        <Text color={colors.dimText}>Tips:</Text>
        <Text color={colors.dimText}>- Press [Tab] to switch to commands view</Text>
        <Text color={colors.dimText}>- Use /push to sync your context to the cloud</Text>
        <Text color={colors.dimText}>- Use /gen-rules to generate agent rules</Text>
        <Text color={colors.dimText}>- Type / for available commands</Text>
      </Box>
      <EnterPrompt
        action="finish onboarding"
        active={mode === 'activity' && currentStep === 'complete'}
        onEnter={() => completeOnboarding()}
      />
    </Box>
  )

  return (
    <Box
      borderColor={colors.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      height={availableHeight}
      width="100%"
    >
      <Box flexDirection="column" paddingX={1}>
        {currentStep === 'init' && (
          <OnboardingStep
            description="Let's get your project set up with ByteRover."
            stepNumber={getStepNumber('init')}
            title="Welcome to ByteRover!"
            totalSteps={totalSteps}
          >
            {renderInitContent()}
          </OnboardingStep>
        )}

        {currentStep === 'curate' && (
          <OnboardingStep
            description="Great! Now let's add some context to your knowledge base."
            stepNumber={getStepNumber('curate')}
            title="Add Your First Context"
            totalSteps={totalSteps}
          >
            {renderCurateContent()}
          </OnboardingStep>
        )}

        {currentStep === 'query' && (
          <OnboardingStep
            description="Excellent! Your context is saved. Let's query it."
            stepNumber={getStepNumber('query')}
            title="Query Your Knowledge"
            totalSteps={totalSteps}
          >
            {renderQueryContent()}
          </OnboardingStep>
        )}

        {currentStep === 'complete' && (
          <OnboardingStep
            description="Your ByteRover workspace is ready!"
            showStepIndicator={false}
            stepNumber={totalSteps}
            title="You're All Set!"
            totalSteps={totalSteps}
          >
            {renderCompleteContent()}
          </OnboardingStep>
        )}
      </Box>
    </Box>
  )
}
