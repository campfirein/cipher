import {useCallback, useState} from 'react'

import type {CommandContext, SlashCommand, SlashCommandActionReturn} from '../../../types/index.js'

import {splitArgs} from '../utils/arg-parser.js'

/**
 * Result of parsing user input
 */
interface ParseResult {
  /** Remaining arguments after command/subcommand */
  args: string
  /** Matched top-level command */
  command?: SlashCommand
  /** Full command name path (e.g. "hub registry list") */
  commandPath: string
  /** Whether input is a slash command */
  isCommand: boolean
  /** Deepest matched subcommand (if any) */
  subCommand?: SlashCommand
}

/**
 * Parse user input to extract command, subcommand, and arguments
 */
function parseInput(input: string, commands: readonly SlashCommand[]): ParseResult {
  const trimmed = input.trim()

  if (!trimmed.startsWith('/')) {
    return {args: trimmed, commandPath: '', isCommand: false}
  }

  const withoutSlash = trimmed.slice(1)
  const parts = withoutSlash.split(/\s+/)
  const commandName = parts[0]?.toLowerCase()

  if (!commandName) {
    return {args: '', commandPath: '', isCommand: true}
  }

  // Find command by name or alias
  const command = commands.find((cmd) => cmd.name === commandName)

  if (!command) {
    return {args: parts.slice(1).join(' '), commandPath: commandName, isCommand: true}
  }

  // Recursively resolve subcommands (e.g. /hub registry list)
  let current = command
  let depth = 1

  while (current.subCommands?.length && depth < parts.length) {
    const nextName = parts[depth]?.toLowerCase()
    const match = current.subCommands.find((sub) => sub.name === nextName)
    if (!match) break
    current = match
    depth++
  }

  const commandPath = parts.slice(0, depth).join(' ')

  return {
    args: parts.slice(depth).join(' '),
    command,
    commandPath,
    isCommand: true,
    ...(current === command ? {} : {subCommand: current}),
  }
}

/**
 * Hook return type
 */
interface UseSlashCommandProcessorReturn {
  /** Handle a slash command input */
  handleSlashCommand: (input: string) => Promise<SlashCommandActionReturn>
  /** Whether a command is currently being processed */
  isProcessing: boolean
}

/**
 * Hook for processing slash commands
 * Handles command parsing, execution, and result handling
 */
export function useSlashCommandProcessor(
  context: CommandContext,
  commands: readonly SlashCommand[],
): UseSlashCommandProcessorReturn {
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSlashCommand = useCallback(
    async (input: string): Promise<SlashCommandActionReturn> => {
      const {args, command, commandPath, isCommand, subCommand} = parseInput(input, commands)

      if (!isCommand) {
        // Slash command only mode - show warning for non-slash input
        return {
          content: 'Please use a slash command. Type / for available commands.',
          messageType: 'error',
          type: 'message',
        }
      }

      if (!command) {
        const commandName = input.trim().slice(1).split(/\s+/)[0]
        return {
          content: `Unknown command: /${commandName}. Type / for available commands.`,
          messageType: 'error',
          type: 'message',
        }
      }

      // Determine which action to execute
      const deepest = subCommand ?? command
      const commandNameForContext = commandPath

      // If the deepest resolved command has no action but has subcommands, show usage
      if (!deepest.action && deepest.subCommands?.length) {
        const subNames = deepest.subCommands.map((s) => s.name).join('|')
        return {
          content: `Usage: /${commandPath} <${subNames}>`,
          messageType: 'error',
          type: 'message',
        }
      }

      const actionToExecute = deepest.action ?? command.action

      if (!actionToExecute) {
        return {
          content: `Command /${commandPath} has no action defined.`,
          messageType: 'error',
          type: 'message',
        }
      }

      // Check for required arguments
      const targetCommand = subCommand ?? command
      const requiredArgs = targetCommand.args?.filter((arg) => arg.required) ?? []

      if (requiredArgs.length > 0 && !args.trim()) {
        const argNames = requiredArgs.map((a) => `<${a.name}>`).join(' ')
        const flagsStr = targetCommand.flags?.map((f) => `[--${f.name}]`).join(' ') ?? ''
        const usage = `/${commandNameForContext} ${argNames}${flagsStr ? ' ' + flagsStr : ''}`
        return {
          content: `Missing required argument(s).\nUsage: ${usage}`,
          messageType: 'error',
          type: 'message',
        }
      }

      // Extract file and folder references from args for context metadata.
      // Pass the original args string to the action — parseReplArgs handles quote-aware splitting internally.
      const {files, folders} = splitArgs(args)

      // Build execution context with invocation details
      const execContext: CommandContext = {
        ...context,
        invocation: {
          args,
          files,
          folders,
          name: commandNameForContext,
          raw: input,
        },
      }

      setIsProcessing(true)

      try {
        const result = await actionToExecute(execContext, args)
        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: `Error executing /${commandNameForContext}: ${errorMessage}`,
          messageType: 'error',
          type: 'message',
        }
      } finally {
        setIsProcessing(false)
      }
    },
    [commands, context],
  )

  return {
    handleSlashCommand,
    isProcessing,
  }
}
