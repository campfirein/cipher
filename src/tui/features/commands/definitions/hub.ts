import type {SlashCommand} from '../../../types/commands.js'

import {hubListCommand} from './hub-list.js'
import {hubRegistryCommand} from './hub-registry.js'

export const hubCommand: SlashCommand = {
  description: 'Browse and manage skills & bundles registry',
  name: 'hub',
  subCommands: [hubListCommand, hubRegistryCommand],
}
