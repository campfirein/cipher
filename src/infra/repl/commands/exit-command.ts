import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'

/**
 * Exit command - Exit chat mode and return to command mode
 *
 * The agent stays alive after exiting, allowing instant re-entry
 * with /chat to resume the same conversation.
 */
export const exitCommand: SlashCommand = {
  action(_context: CommandContext, _args: string) {
    return {
      type: 'exit_chat_mode' as const,
    }
  },
  autoExecute: true,
  description: 'Exit chat mode and return to command mode',
  kind: CommandKind.BUILT_IN,
  name: 'exit',
}
