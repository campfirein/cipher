import type {SlashCommand} from '../../../types/commands.js'

import {connectorsCommand} from './connectors.js'
import {curateCommand} from './curate.js'
import {initCommand} from './init.js'
import {loginCommand} from './login.js'
import {logoutCommand} from './logout.js'
import {modelCommand} from './model.js'
import {newCommand} from './new.js'
import {providerCommand} from './provider.js'
import {pullCommand} from './pull.js'
import {pushCommand} from './push.js'
import {queryCommand} from './query.js'
import {resetCommand} from './reset.js'
import {spaceCommand} from './space.js'
import {statusCommand} from './status.js'

/**
 * Load all REPL slash commands.
 *
 * IMPORTANT: Order matters - commands are displayed in the UI suggestions
 * in the same order as defined here. Keep grouped by priority/category.
 */
export const load: () => SlashCommand[] = () => [
  // Core workflow - most frequently used
  statusCommand,
  curateCommand,
  queryCommand,

  // Connectors management
  connectorsCommand,

  // Provider management
  providerCommand,
  modelCommand,

  // Sync operations
  pushCommand,
  pullCommand,

  // Space management
  spaceCommand,

  // Context tree management
  resetCommand,

  // Session management
  newCommand,

  // Setup
  initCommand,

  // Auth
  loginCommand,
  logoutCommand,
]
