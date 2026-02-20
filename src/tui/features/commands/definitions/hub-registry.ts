import type {SlashCommand} from '../../../types/commands.js'

import {hubRegistryAddCommand} from './hub-registry-add.js'
import {hubRegistryListCommand} from './hub-registry-list.js'
import {hubRegistryRemoveCommand} from './hub-registry-remove.js'

export const hubRegistryCommand: SlashCommand = {
  description: 'Manage hub registries',
  name: 'registry',
  subCommands: [hubRegistryListCommand, hubRegistryAddCommand, hubRegistryRemoveCommand],
}
