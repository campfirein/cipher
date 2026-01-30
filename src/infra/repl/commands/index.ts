import {SlashCommand} from '../../../tui/types.js'
import {connectorsCommand} from './connectors-command.js'
import {curateCommand} from './curate-command.js'
import {initCommand} from './init-command.js'
import {loginCommand} from './login-command.js'
import {logoutCommand} from './logout-command.js'
import {modelCommand} from './model-command.js'
import {newCommand} from './new-command.js'
import {providerCommand} from './provider-command.js'
import {pullCommand} from './pull-command.js'
import {pushCommand} from './push-command.js'
import {queryCommand} from './query-command.js'
import {resetCommand} from './reset-command.js'
import {spaceCommand} from './space/index.js'
import {statusCommand} from './status-command.js'

/**
 * Load all REPL slash commands.
 *
 * IMPORTANT: Order matters - commands are displayed in the UI suggestions
 * in the same order as defined here. Keep grouped by priority/category.
 */
export const load: () => SlashCommand[] = () => [
  // Core workflow - most frequently used
  statusCommand, // Quick check current state
  curateCommand, // Add context (primary action)
  queryCommand, // Query context tree

  // Connectors management
  connectorsCommand, // Manage agent connectors (rules/hook)

  // Provider management
  providerCommand, // Connect to LLM providers
  modelCommand, // Select model from provider

  // Sync operations
  pushCommand, // Push to cloud
  pullCommand, // Pull from cloud

  // Space management
  spaceCommand, // Switch/list spaces

  // Context tree management
  resetCommand, // Reset context tree (destructive)

  // Session management
  newCommand, // Start fresh session (ends current, clears conversation)

  // Setup
  initCommand, // Project setup (once per project)

  // Auth
  loginCommand, // Sign in
  logoutCommand, // Sign out
]
