import type {SlashCommand} from '../../../types/commands.js'

import {spaceListCommand} from './space-list.js'
import {spaceSwitchCommand} from './space-switch.js'

export const spaceCommand: SlashCommand = {
  description: 'Manage ByteRover spaces',
  name: 'space',
  subCommands: [spaceListCommand, spaceSwitchCommand],
}
