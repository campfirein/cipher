import type {SlashCommand} from '../../../types/commands.js'

import {sourceAddSubCommand} from './source-add.js'
import {sourceListSubCommand} from './source-list.js'
import {sourceRemoveSubCommand} from './source-remove.js'

export const sourceCommand: SlashCommand = {
  description: "Manage knowledge sources from other projects' context trees",
  name: 'source',
  subCommands: [sourceAddSubCommand, sourceRemoveSubCommand, sourceListSubCommand],
}
