import {SlashCommand} from '../../../tui/types.js'
import {chatCommand} from './chat-command.js'
import {clearCommand} from './clear-command.js'
import {curateCommand} from './curate-command.js'
import {exitCommand} from './exit-command.js'
import {genRulesCommand} from './gen-rules-command.js'
import {initCommand} from './init-command.js'
import {loginCommand} from './login-command.js'
import {logoutCommand} from './logout-command.js'
import {pullCommand} from './pull-command.js'
import {pushCommand} from './push-command.js'
import {queryCommand} from './query-command.js'
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
  chatCommand, // Enter persistent chat mode
  curateCommand, // Add context (primary action)
  queryCommand, // Query context tree

  // Sync operations
  pushCommand, // Push to cloud
  pullCommand, // Pull from cloud

  // Space management
  spaceCommand, // Switch/list spaces

  // Context tree management
  genRulesCommand, // Generate rule files
  clearCommand, // Reset context tree (destructive)

  // Setup
  initCommand, // Project setup (once per project)

  // Auth
  loginCommand, // Sign in
  logoutCommand, // Sign out

  // Chat mode
  exitCommand, // Exit chat mode
]
