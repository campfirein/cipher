import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'

/**
 * Chat command - Enter persistent chat mode with Cipher agent
 *
 * In chat mode:
 * - Non-slash input is sent directly to the agent
 * - Conversation history is maintained across messages
 * - Use /exit to return to command mode
 */
export const chatCommand: SlashCommand = {
  action(_context: CommandContext, _args: string) {
    return {
      type: 'enter_chat_mode' as const,
    }
  },
  aliases: ['c'],
  autoExecute: true,
  description: 'Enter persistent chat mode with Cipher agent',
  kind: CommandKind.BUILT_IN,
  name: 'chat',
}
