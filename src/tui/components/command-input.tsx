/**
 * CommandInput Component
 *
 * Handles command input with suggestions and executes slash commands.
 */

import {Box, Text, useInput} from 'ink'
import TextInput from 'ink-text-input'
import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'

import type {OnboardingStep} from '../hooks/index.js'
import type {PromptRequest, StreamingMessage} from '../types.js'

import {useCommands} from '../contexts/commands-context.js'
import {useAuth, useTasks, useTransport} from '../contexts/index.js'
import {useMode, useOnboarding, useTheme} from '../hooks/index.js'
import {Suggestions} from './suggestions.js'

/**
 * Get onboarding instruction based on current step
 */
function getInstructionText(currentStep: OnboardingStep, highlightColor: string): ReactNode {
  switch (currentStep) {
    case 'curate': {
      return (
        <Text>
          Create your first memory with <Text color={highlightColor}>/curate</Text>
        </Text>
      )
    }

    case 'explore': {
      return (
        <Text>
          Next, type <Text color={highlightColor}>/</Text> to explore more commands
        </Text>
      )
    }

    case 'query': {
      return (
        <Text>
          Now retrieve your memory by using <Text color={highlightColor}>/query</Text>
        </Text>
      )
    }

    default: {
      return null
    }
  }
}

/**
 * Get instruction for pressing Enter to run
 */
function getInstruction({
  currentStep,
  highlightBgColor,
  highlightTextColor,
  textColor,
}: {
  currentStep: OnboardingStep
  highlightBgColor: string
  highlightTextColor: string
  textColor: string
}): ReactNode {
  if (currentStep === 'explore' || currentStep === 'curating' || currentStep === 'querying') return null

  return (
    <Text color={textColor}>
     {" "}· Press <Text backgroundColor={highlightBgColor} color={highlightTextColor}> Enter </Text> to run (Esc to skip the instruction)
    </Text>
  )
}

export const CommandInput = () => {
  const {reloadAuth, reloadBrvConfig} = useAuth()
  const {client} = useTransport()
  const {clearTasks} = useTasks()
  const {theme: {colors}} = useTheme()
  const {mode} = useMode()
  const {
    activePrompt,
    handleSlashCommand,
    isStreaming,
    setActivePrompt,
    setIsStreaming,
    setMessages,
    setStreamingMessages,
  } = useCommands()
  const [inputValue, setInputValue] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const ctrlOPressedRef = useRef(false)
  const previousInputRef = useRef('')
  const {completeOnboarding, currentStep, removeHighlightedCommand, shouldShowOnboarding} = useOnboarding()

  // Check if in prefilled onboarding steps (curate or query)
  const isInCurate = shouldShowOnboarding && currentStep === 'curate'
  const isInQuery = shouldShowOnboarding && currentStep === 'query'
  const isInCurating = shouldShowOnboarding && currentStep === 'curating'
  const isInQuerying = shouldShowOnboarding && currentStep === 'querying'
  const isInExplore = shouldShowOnboarding && currentStep === 'explore'

  // Fixed input value for curate/query onboarding steps
  const displayInputValue = useMemo(() => {
    if (isInCurate) return '/curate Memory is a core component of an agent system.'
    if (isInCurating) return ''
    if (isInQuery) return '/query What are the core components of an agent system?'
    if (isInQuerying) return ''
    return inputValue
  }, [shouldShowOnboarding, currentStep, inputValue])

  // Placeholder based on onboarding step
  const placeholder = useMemo(() => {
    if (isStreaming || isInCurating || isInQuerying) return 'Processing...'
    if (isInExplore) return 'Type /'
    return 'Type a command...'
  }, [isStreaming, shouldShowOnboarding, currentStep])

  // Filter out "o" character when Ctrl+O is pressed
  useEffect(() => {
    if (ctrlOPressedRef.current) {
      // Check if "o" was just added to the end
      if (inputValue === previousInputRef.current + 'o') {
        setInputValue(previousInputRef.current)
      }

      ctrlOPressedRef.current = false
    }
  }, [inputValue])

  // Detect Ctrl+O to prevent "o" from being inserted
  useInput((input, key) => {
    if (key.ctrl && input === 'o') {
      previousInputRef.current = inputValue
      ctrlOPressedRef.current = true
    }
  })

  // Skip onboarding with Esc
  useInput(
    (_input, key) => {
      if (key.escape) {
        completeOnboarding(true)
      }
    },
    {isActive: shouldShowOnboarding && (currentStep === 'curate' || currentStep === 'query')},
  )

  // Cancel streaming command with Esc (only for commands that add to messages, not /curate or /query)
  useInput(
    (_input, key) => {
      if (key.escape) {
        // Add cancellation message to the latest command's output
        setMessages((prev) => {
          const updated = [...prev]
          const lastIndex = updated.length - 1
          // Only cancel if there's a command message
          if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
            const cancelMsg: StreamingMessage = {
              content: 'Command cancelled.',
              id: `cancel-${Date.now()}`,
              type: 'output',
            }
            const existingOutput = updated[lastIndex].output ?? []
            updated[lastIndex] = {...updated[lastIndex], output: [...existingOutput, cancelMsg], timestamp: new Date()}
          }

          return updated
        })

        // Reset streaming state
        setStreamingMessages([])
        setIsStreaming(false)
        setActivePrompt(null)
      }
    },
    {isActive: isStreaming && !shouldShowOnboarding},
  )

  /* eslint-disable complexity -- Command execution requires handling multiple command types and states */
  const executeCommand = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      // During query onboarding step, only allow /query commands
      if (shouldShowOnboarding && currentStep === 'query' && !trimmed.startsWith('/query ')) return

      // Clear command input immediately
      setInputValue('')

      // Remove from highlighted commands if it's a slash command
      if (trimmed.startsWith('/')) {
        const commandName = trimmed.slice(1).split(' ')[0]
        removeHighlightedCommand(commandName)
      }

      // Skip adding to messages for commands that are rendered via useActivityLogs
      const isRenderedByActivityLogs = trimmed.startsWith('/curate') || trimmed.startsWith('/query')

      if (!isRenderedByActivityLogs) {
        setMessages((prev) => [
          ...prev,
          {
            content: '',
            fromCommand: trimmed.startsWith('/') ? trimmed.slice(1) : trimmed,
            type: 'command',
          },
        ])
      }

      const result = await handleSlashCommand(trimmed)

      if (result && result.type === 'message') {
        setMessages((prev) => {
          const last = prev.at(-1)

          return [
            ...(last?.type === 'command' ? prev.slice(0, -1) : [...prev]),
            {
              content: result.content,
              fromCommand: trimmed.startsWith('/') ? trimmed.slice(1) : trimmed,
              timestamp: new Date(),
              type: result.messageType === 'error' ? 'error' : 'info',
            },
          ]
        })
      }

      if (result && result.type === 'streaming') {
        setIsStreaming(true)
        setStreamingMessages([])

        const collectedMessages: StreamingMessage[] = []

        const onMessage = (msg: StreamingMessage) => {
          collectedMessages.push(msg)
          if (!isRenderedByActivityLogs) {
            setStreamingMessages((prev) => [...prev, msg])
          }
        }

        const onPrompt = (prompt: PromptRequest) => {
          if (!isRenderedByActivityLogs) {
            setActivePrompt(prompt)
          }
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
          if (!isRenderedByActivityLogs) {
            setMessages((prev) => {
              const updated = [...prev]
              const lastIndex = updated.length - 1
              if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
                updated[lastIndex] = { ...updated[lastIndex], output: collectedMessages, timestamp: new Date() }
              }

              return updated
            })
          }

          setStreamingMessages([])
          setIsStreaming(false)
          setActivePrompt(null)
          const needReloadAuth = trimmed.startsWith('/login') || trimmed.startsWith('/logout')
          const needReloadBrvConfig = trimmed.startsWith('/space switch') || trimmed.startsWith('/init')
          const needNewSession = trimmed.startsWith('/new')

          // Handle /new command - create new session and clear messages
          if (needNewSession && client) {
            try {
              const response = await client.requestWithAck<{ error?: string; sessionId?: string; success: boolean }>(
                'agent:newSession',
                {reason: 'User requested new session'},
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
          if (needReloadAuth || needReloadBrvConfig) {
            clearTasks()

            if (needReloadAuth) await reloadAuth()
            if (needReloadBrvConfig) await reloadBrvConfig()

            // Restart agent with appropriate reason
            if (client) {
              const reasonMap: Record<string, string> = {
                '/init': 'Project initialized',
                '/login': 'User logged in',
                '/logout': 'User logged out',
                '/space switch': 'Space switched',
              }

              const reason = Object.entries(reasonMap).find(([cmd]) => trimmed.startsWith(cmd))?.[1] ?? 'Command executed'

              await client.requestWithAck('agent:restart', {reason})
            }
          }
        }
      }
    },
    [clearTasks, client, currentStep, handleSlashCommand, reloadAuth, reloadBrvConfig, removeHighlightedCommand, setActivePrompt, setIsStreaming, setMessages, setStreamingMessages, shouldShowOnboarding],
  )
  /* eslint-enable complexity */

  const handleSubmit = useCallback(
    async (value: string) => {
      if (mode === 'main' && !isStreaming) {
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
    const suffix = value.endsWith('/') ? '' : ' '
    setInputValue(value + suffix)
    setInputKey((prev) => prev + 1)
  }, [])

  // Hide suggestions during onboarding curate/query steps to focus user on the task
  const shouldShowSuggestions = !isStreaming && !(shouldShowOnboarding && (currentStep === 'curate' || currentStep === 'query'))

  return (
    <Box flexDirection="column" flexShrink={0}>
      {shouldShowSuggestions && (
        <Suggestions input={inputValue} onInsert={handleInsert} onSelect={handleSelect} />
      )}

      {shouldShowOnboarding && (
        <Box>
          {getInstructionText(currentStep, colors.warning)}
          {getInstruction({
            currentStep,
            highlightBgColor: colors.primary,
            highlightTextColor: colors.bg1,
            textColor: colors.dimText,
          })}
        </Box>
      )}

      <Box borderColor={colors.border} borderLeft={false} borderRight={false} borderStyle="single" paddingX={2}>
        <Text color={colors.primary}>{'> '}</Text>
        <TextInput
          focus={!activePrompt && (mode === 'main' || mode === 'suggestions')}
          key={inputKey}
          onChange={(value) => {
            if (!(isInCurate || isInCurating || isInQuery || isInQuerying)) setInputValue(value)

            if (isInExplore && value.startsWith('/')) {
              completeOnboarding()
            }
          }}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          showCursor={!(isInCurate || isInQuery)}
          value={displayInputValue}
        />
      </Box>
    </Box>
  )
}
