import {useCallback, useState} from 'react'

import type {CommandContext, SlashCommand, SlashCommandActionReturn} from '../types.js'

import {splitArgs} from '../../infra/repl/commands/arg-parser.js'

/**
 * Result of parsing user input
 */
interface ParseResult {
  /** Remaining arguments after command/subcommand */
  args: string
  /** Matched command */
  command?: SlashCommand
  /** Whether input is a slash command */
  isCommand: boolean
  /** Matched subcommand (if any) */
  subCommand?: SlashCommand
}

/**
 * Parse user input to extract command, subcommand, and arguments
 */
function parseInput(input: string, commands: readonly SlashCommand[]): ParseResult {
  const trimmed = input.trim()

  if (!trimmed.startsWith('/')) {
    return {args: trimmed, isCommand: false}
  }

  const withoutSlash = trimmed.slice(1)
  const parts = withoutSlash.split(/\s+/)
  const commandName = parts[0]?.toLowerCase()

  if (!commandName) {
    return {args: '', isCommand: true}
  }

  // Find command by name or alias
  const command = commands.find((cmd) => cmd.name === commandName || cmd.aliases?.includes(commandName))

  if (!command) {
    return {args: parts.slice(1).join(' '), isCommand: true}
  }

  // Check for subcommand
  if (command.subCommands?.length && parts.length > 1) {
    const subCommandName = parts[1]?.toLowerCase()
    const subCommand = command.subCommands.find(
      (sub) => sub.name === subCommandName || sub.aliases?.includes(subCommandName),
    )

    if (subCommand) {
      return {
        args: parts.slice(2).join(' '),
        command,
        isCommand: true,
        subCommand,
      }
    }
  }

  return {
    args: parts.slice(1).join(' '),
    command,
    isCommand: true,
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
      const {args, command, isCommand, subCommand} = parseInput(input, commands)

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
      const actionToExecute = subCommand?.action ?? command.action
      const commandNameForContext = subCommand ? `${command.name} ${subCommand.name}` : command.name

      if (!actionToExecute) {
        // Command has no action and no matching subcommand
        if (command.subCommands?.length) {
          const subNames = command.subCommands.map((s) => s.name).join('|')
          return {
            content: `Usage: /${command.name} <${subNames}>`,
            messageType: 'error',
            type: 'message',
          }
        }

        return {
          content: `Command /${command.name} has no action defined.`,
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

      // Extract file references from args
      const {args: argsWithoutFiles, files} = splitArgs(args)
      const cleanArgs = argsWithoutFiles.join(' ')

      // Build execution context with invocation details
      const execContext: CommandContext = {
        ...context,
        invocation: {
          args: cleanArgs,
          files,
          name: commandNameForContext,
          raw: input,
        },
        slashCommands: commands,
      }

      setIsProcessing(true)

      try {
        const result = await actionToExecute(execContext, cleanArgs)
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
