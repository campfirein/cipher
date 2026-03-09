import type {SlashCommand} from '../../../types/commands.js'

import {vcInitSubCommand} from './vc-init.js'
import {vcStatusSubCommand} from './vc-status.js'

export const vcCommand: SlashCommand = {
  description: 'Version control commands for the context tree',
  name: 'vc',
  subCommands: [vcInitSubCommand, vcStatusSubCommand],
}
