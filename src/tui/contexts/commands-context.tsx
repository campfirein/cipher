/**
 * Commands Context
 *
 * Global context for managing slash commands across the entire app.
 * Loads commands on mount and provides them to any component.
 *
 * Usage:
 * ```tsx
 * const {commands, handleSlashCommand} = useCommands()
 *
 * // Access commands
 * commands.forEach(cmd => console.log(cmd.name))
 *
 * // Execute a command
 * const result = await handleSlashCommand('/help')
 * ```
 */

import React, {createContext, useContext, useEffect, useMemo, useState} from 'react'

import type {CommandContext, CommandMessage, PromptRequest, SlashCommand, SlashCommandActionReturn, StreamingMessage} from '../types.js'

import {load} from '../../infra/repl/commands/index.js'
import {useSlashCommandProcessor} from '../hooks/index.js'
import {useServices} from './services-context.js'

interface CommandsContextValue {
  activePrompt: null | PromptRequest
  commands: readonly SlashCommand[]
  handleSlashCommand: (input: string) => Promise<SlashCommandActionReturn>
  isStreaming: boolean
  messages: CommandMessage[]
  setActivePrompt: (prompt: null | PromptRequest) => void
  setIsStreaming: (isStreaming: boolean) => void
  setMessages: React.Dispatch<React.SetStateAction<CommandMessage[]>>
  setStreamingMessages: React.Dispatch<React.SetStateAction<StreamingMessage[]>>
  streamingMessages: StreamingMessage[]
}

const CommandsContext = createContext<CommandsContextValue | undefined>(undefined)

interface CommandsProviderProps {
  children: React.ReactNode
}

export function CommandsProvider({children}: CommandsProviderProps): React.ReactElement {
  const [commands, setCommands] = useState<readonly SlashCommand[]>([])
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const {version} = useServices()

  useEffect(() => {
    const abortController = new AbortController()

    async function loadCommands() {
      setCommands(load())
    }

    loadCommands()

    return () => {
      abortController.abort()
    }
  }, [])

  const commandContext: CommandContext = useMemo(
    () => ({
      version,
    }),
    [version],
  )

  const {handleSlashCommand} = useSlashCommandProcessor(commandContext, commands)

  const contextValue = useMemo(
    () => ({
      activePrompt,
      commands,
      handleSlashCommand,
      isStreaming,
      messages,
      setActivePrompt,
      setIsStreaming,
      setMessages,
      setStreamingMessages,
      streamingMessages,
    }),
    [activePrompt, commands, handleSlashCommand, isStreaming, messages, streamingMessages],
  )

  return <CommandsContext.Provider value={contextValue}>{children}</CommandsContext.Provider>
}

export function useCommands(): CommandsContextValue {
  const context = useContext(CommandsContext)
  if (!context) {
    throw new Error('useCommands must be used within CommandsProvider')
  }

  return context
}
