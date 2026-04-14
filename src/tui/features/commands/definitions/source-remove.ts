import type {SlashCommand} from '../../../types/commands.js'

import {removeSourceViaTransport} from '../../source/api/source-api.js'

export const sourceRemoveSubCommand: SlashCommand = {
  async action(_context, args) {
    const argTrimmed = args?.trim()
    if (!argTrimmed) {
      return {
        content: 'Usage: /source remove <alias-or-path>',
        messageType: 'error',
        type: 'message',
      }
    }

    try {
      const result = await removeSourceViaTransport(argTrimmed)

      return {
        content: result.message,
        messageType: 'error',
        type: 'message',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Source remove failed: ${message}`,
        messageType: 'error',
        type: 'message',
      }
    }
  },
  args: [
    {
      description: 'Alias or path of the knowledge source to remove',
      name: 'aliasOrPath',
      required: true,
    },
  ],
  description: 'Remove a knowledge source',
  name: 'remove',
}
