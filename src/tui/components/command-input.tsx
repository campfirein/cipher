/**
 * CommandInput Component
 *
 * Handles command input with suggestions and executes slash commands.
 */

import {useQueryClient} from '@tanstack/react-query'
import {Box, Text, useInput} from 'ink'
import TextInput from 'ink-text-input'
import React, {ReactNode, useCallback, useEffect, useRef, useState} from 'react'

import type {OnboardingFlowStep} from '../hooks/index.js'
import type {CommandSideEffects} from '../types/commands.js'
import type {StreamingMessage} from '../types/index.js'

import {getAuthStateQueryOptions} from '../features/auth/api/get-auth-state.js'
import {useTasksStore} from '../features/tasks/stores/tasks-store.js'
import {useCommands, useMode, useOnboarding, useTheme} from '../hooks/index.js'
import {useTransportStore} from '../stores/transport-store.js'
import {Suggestions} from './suggestions.js'

/**
 * Get onboarding instruction based on current step
 */
function getInstructionText(step: OnboardingFlowStep, highlightColor: string): ReactNode {
  switch (step) {
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
  highlightBgColor,
  highlightTextColor,
  step,
  textColor,
}: {
  highlightBgColor: string
  highlightTextColor: string
  step: OnboardingFlowStep
  textColor: string
}): ReactNode {
  if (step === 'explore' || step === 'curating' || step === 'querying') return null

  return (
    <Text color={textColor}>
      {' '}
      · Press{' '}
      <Text backgroundColor={highlightBgColor} color={highlightTextColor}>
        {' '}
        Enter{' '}
      </Text>{' '}
      to run (Esc to skip the instruction)
    </Text>
  )
}

export const CommandInput = () => {
  const queryClient = useQueryClient()
  const client = useTransportStore((s) => s.client)
  const clearTasks = useTasksStore((s) => s.clearTasks)
  const {
    theme: {colors},
  } = useTheme()
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
  const [activeDialog, setActiveDialog] = useState<ReactNode>(null)
  const ctrlOPressedRef = useRef(false)
  const previousInputRef = useRef('')
  const {complete, viewMode} = useOnboarding()

  const isOnboarding = viewMode.type === 'onboarding'
  const currentStep = viewMode.type === 'onboarding' ? viewMode.step : null

  // Fixed input value for curate onboarding step (only before user has curated and not currently curating)
  const isInCurateStep = isOnboarding && currentStep === 'curate'
  const displayInputValue = isInCurateStep ? '/curate Memory is a core component of an agent system.' : inputValue

  // Placeholder based on onboarding step
  const getPlaceholder = () => {
    if (isStreaming) return 'Processing...'
    if (isOnboarding && currentStep) {
      if (currentStep === 'query') return 'Try "/query What are the core components of an agent system?"'
      if (currentStep === 'explore') return 'Type /'
    }

    return 'Type a command...'
  }

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
        complete({skipped: true})
      }
    },
    {isActive: isOnboarding && (currentStep === 'curate' || currentStep === 'query')},
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
    {isActive: isStreaming && !isOnboarding},
  )

  const executeCommand = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      // During query onboarding step, only allow /query commands
      if (isOnboarding && currentStep === 'query' && !trimmed.startsWith('/query ')) return

      // Clear command input immediately
      setInputValue('')

      // Commands that create tasks (shown as ActivityLog) should not add command messages
      // to avoid duplicates in the activity feed
      const commandName = trimmed.startsWith('/') ? trimmed.slice(1).split(' ')[0] : ''
      const isTaskCommand = commandName === 'curate' || commandName === 'query'

      if (!isTaskCommand) {
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

      if (result && 'type' in result && result.type === 'message') {
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

      if (result && 'render' in result) {
        setIsStreaming(true)

        const dialog = result.render({
          onCancel() {
            setActiveDialog(null)
            setIsStreaming(false)
          },
          async onComplete(message: string, sideEffects?: CommandSideEffects) {
            setActiveDialog(null)
            setIsStreaming(false)
            // Update command message with result
            setMessages((prev) => {
              const updated = [...prev]
              const lastIndex = updated.length - 1
              if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
                const resultMsg: StreamingMessage = {
                  content: message,
                  id: `result-${Date.now()}`,
                  type: 'output',
                }
                const existingOutput = updated[lastIndex].output ?? []
                updated[lastIndex] = {
                  ...updated[lastIndex],
                  output: [...existingOutput, resultMsg],
                  timestamp: new Date(),
                }
              }

              return updated
            })

            // Process side effects declared by the command
            if (sideEffects) {
              if (sideEffects.clearSession) {
                setMessages([])
                clearTasks()
                if (client) {
                  try {
                    await client.requestWithAck<{error?: string; sessionId?: string; success: boolean}>(
                      'agent:newSession',
                      {reason: 'User requested new session'},
                    )
                  } catch {
                    // Session creation error — command already showed feedback
                  }
                }
              }

              if (sideEffects.reloadAuth) {
                clearTasks()
                await queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
              }

              if (sideEffects.reloadConfig) {
                clearTasks()
                // Config is part of auth state, so invalidating auth also reloads config
                await queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
              }

              if (sideEffects.restartAgent && client) {
                await client.request('agent:restart', {reason: sideEffects.restartAgent.reason})
              }
            }
          },
        })

        setActiveDialog(dialog)
      }
    },
    [
      clearTasks,
      client,
      currentStep,
      handleSlashCommand,
      isOnboarding,
      queryClient,
      setActivePrompt,
      setIsStreaming,
      setMessages,
      setStreamingMessages,
    ],
  )

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
  const shouldShowSuggestions = !isStreaming && !(isOnboarding && (currentStep === 'curate' || currentStep === 'query'))

  return (
    <Box flexDirection="column" flexShrink={0}>
      {activeDialog}

      {shouldShowSuggestions && <Suggestions input={inputValue} onInsert={handleInsert} onSelect={handleSelect} />}

      {isOnboarding && currentStep && (
        <Box>
          {getInstructionText(currentStep, colors.warning)}
          {getInstruction({
            highlightBgColor: colors.primary,
            highlightTextColor: colors.bg1,
            step: currentStep,
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
            if (!isInCurateStep) setInputValue(value)

            if (isOnboarding && currentStep === 'explore' && value.startsWith('/')) {
              complete()
            }
          }}
          onSubmit={handleSubmit}
          placeholder={getPlaceholder()}
          showCursor={!isInCurateStep}
          value={displayInputValue}
        />
      </Box>
    </Box>
  )
}
