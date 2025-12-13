import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Status command
 */
export const statusCommand: SlashCommand = {
  aliases: [],
  args: [
    {
      description: 'Project directory (defaults to current directory)',
      name: 'directory',
      required: false,
    },
  ],
  autoExecute: true,
  description: 'Show CLI status and project information',
  flags: [
    {
      char: 'f',
      default: 'table',
      description: 'Output format (table or json)',
      name: 'format',
      type: 'string',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'status',
}
