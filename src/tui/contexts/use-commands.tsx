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

import type {CommandContext, SlashCommand, SlashCommandActionReturn} from '../types.js'

import {load} from '../../infra/repl/commands/index.js'
import {useSlashCommandProcessor} from '../hooks/index.js'

interface CommandsContextValue {
  commands: readonly SlashCommand[]
  handleSlashCommand: (input: string) => Promise<SlashCommandActionReturn>
}

const CommandsContext = createContext<CommandsContextValue | undefined>(undefined)

interface CommandsProviderProps {
  children: React.ReactNode
}

export function CommandsProvider({children}: CommandsProviderProps): React.ReactElement {
  const [commands, setCommands] = useState<readonly SlashCommand[]>([])

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
      slashCommands: commands,
      // version:, -> need pass version here
      // syncService:, -> need pass sync service here
    }),
    [commands],
  )

  const {handleSlashCommand} = useSlashCommandProcessor(commandContext, commands)

  const contextValue = useMemo(
    () => ({
      commands,
      handleSlashCommand,
    }),
    [commands, handleSlashCommand],
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
