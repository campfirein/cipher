/**
 * Commands Controller Hook
 *
 * Provides command definitions and execution.
 * Uses CommandsStore for state, adds command loading and execution logic.
 */

import {useEffect, useMemo, useState} from 'react'

import type {CommandContext, SlashCommand, SlashCommandActionReturn} from '../../../types/index.js'

import {useTransportStore} from '../../../stores/transport-store.js'
import {load} from '../definitions/index.js'
import {useCommandsStore} from '../stores/commands-store.js'
import {useSlashCommandProcessor} from './use-slash-command-processor.js'

export interface UseCommandsControllerReturn {
  /** Loaded command definitions */
  commands: readonly SlashCommand[]
  /** Execute a slash command */
  handleSlashCommand: (input: string) => Promise<SlashCommandActionReturn>
}

/**
 * Hook that provides command definitions and execution.
 * State (messages, prompts, streaming) is accessed directly from useCommandsStore.
 */
export function useCommandsController(): UseCommandsControllerReturn {
  const [commands, setCommands] = useState<readonly SlashCommand[]>([])
  const version = useTransportStore((s) => s.version)

  // Load commands on mount
  useEffect(() => {
    setCommands(load())
  }, [])

  const commandContext: CommandContext = useMemo(
    () => ({
      version,
    }),
    [version],
  )

  const {handleSlashCommand} = useSlashCommandProcessor(commandContext, commands)

  return {
    commands,
    handleSlashCommand,
  }
}

/**
 * Combined hook that provides both controller and store state.
 * This is the main hook for components that need full command functionality.
 */
export function useCommands() {
  const controller = useCommandsController()
  const store = useCommandsStore()

  return {
    ...store,
    ...controller,
  }
}
