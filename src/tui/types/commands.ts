/**
 * Command-related types
 */

import type React from 'react'

import type {PromptRequest, StreamingMessage} from './index.js'

/**
 * Command kind indicates the source/type of command
 * Based on Gemini CLI pattern for extensibility
 */
export enum CommandKind {
  /** Built-in commands defined in code */
  BUILT_IN = 'built-in',
  /** Future: file-based commands */
  FILE = 'file',
  /** Commands that dispatch to oclif CLI commands */
  OCLIF = 'oclif',
}

/**
 * Command argument definition
 */
export interface CommandArg {
  /** Argument description */
  description: string
  /** Argument name */
  name: string
  /** Whether the argument is required */
  required?: boolean
}

/**
 * Command flag definition
 */
export interface CommandFlag {
  /** Short flag character (e.g., 'b' for -b) */
  char?: string
  /** Default value */
  default?: boolean | string
  /** Flag description */
  description: string
  /** Flag name (e.g., 'branch' for --branch) */
  name: string
  /** Flag type */
  type: 'boolean' | 'file' | 'string'
}

/**
 * Context passed to command action functions
 */
export interface CommandContext {
  /**
   * Invocation details about the current command execution
   */
  invocation?: {
    /** Arguments passed to the command (without @file/@folder references) */
    args: string
    /** File references extracted from @filepath tokens (non-directory paths) */
    files: string[]
    /** Folder references extracted from @folderpath tokens (directory paths) */
    folders: string[]
    /** Resolved command name */
    name: string
    /** Full raw input string */
    raw: string
  }
  /**
   * CLI version
   */
  version?: string
}

/**
 * Subcommand info for display in suggestions
 */
export interface CommandSubcommandInfo {
  /** Subcommand description */
  description: string
  /** Subcommand name */
  name: string
}

/**
 * Suggestion item for auto-completion
 */
export interface CommandSuggestion {
  /** Command arguments */
  args?: CommandArg[]
  /** Command kind for styling */
  commandKind?: CommandKind
  /** Optional description */
  description?: string
  /** Command flags */
  flags?: CommandFlag[]
  /** Display label */
  label: string
  /** Subcommands for commands with nested commands */
  subCommands?: CommandSubcommandInfo[]
  /** Value to insert on selection */
  value: string
}

// ============================================================================
// Action Return Types
// ============================================================================

/**
 * Command action return type for displaying a message
 */
export interface MessageActionReturn {
  content: string
  messageType: 'error' | 'info'
  type: 'message'
}

/**
 * Command action return type for quitting the REPL
 */
export interface QuitActionReturn {
  type: 'quit'
}

/**
 * Command action return type for rendering a custom dialog component
 */
export interface CustomDialogActionReturn {
  component: React.ReactNode
  type: 'custom_dialog'
}

/**
 * Command action return type for clearing the screen
 */
export interface ClearActionReturn {
  type: 'clear'
}

/**
 * Command action return type for streaming output with interactive prompts
 */
export interface StreamingActionReturn {
  /**
   * Async function that executes the command
   * @param onMessage - Callback for streaming output messages
   * @param onPrompt - Callback for interactive prompts (search, confirm, select)
   */
  execute: (onMessage: (msg: StreamingMessage) => void, onPrompt: (prompt: PromptRequest) => void) => Promise<void>
  type: 'streaming'
}

/**
 * Command action return type for confirming an action
 * Uses callback pattern for handling confirmation result (Gemini CLI pattern)
 */
export interface ConfirmActionReturn {
  /**
   * Callback invoked when user makes a choice
   * @param confirmed - true if user confirmed, false if cancelled
   * @returns Optional streaming action to execute after confirmation
   */
  onConfirm: (confirmed: boolean) => Promise<StreamingActionReturn | void> | StreamingActionReturn | void
  prompt: string
  type: 'confirm_action'
}

/**
 * Command action return type for submitting a prompt
 */
export interface SubmitPromptReturn {
  content: string
  type: 'submit_prompt'
}

/**
 * Command action return type for showing query input dialog
 */
export interface QueryDialogActionReturn {
  type: 'query_dialog'
}

/**
 * Command action return type for showing curate option dialog
 */
export interface CurateDialogActionReturn {
  type: 'curate_dialog'
}

/**
 * Command action return type for refreshing auth state (after logout/login)
 */
export interface RefreshAuthActionReturn {
  type: 'refresh_auth'
}

/**
 * Union of all possible command action return types
 */
export type SlashCommandActionReturn =
  | ClearActionReturn
  | ConfirmActionReturn
  | CurateDialogActionReturn
  | CustomDialogActionReturn
  | MessageActionReturn
  | QueryDialogActionReturn
  | QuitActionReturn
  | RefreshAuthActionReturn
  | StreamingActionReturn
  | SubmitPromptReturn
  | void

/**
 * Slash command definition (based on Gemini CLI pattern)
 * Supports nested subcommands, auto-completion, and flexible action returns
 */
export interface SlashCommand {
  /**
   * Action function that executes the command
   * Optional for commands that only have subcommands
   */
  action?: (context: CommandContext, args: string) => Promise<SlashCommandActionReturn> | SlashCommandActionReturn
  /**
   * Alternative names for the command (e.g., 'q' for 'quit')
   */
  aliases?: string[]
  /**
   * Command arguments definition
   */
  args?: CommandArg[]
  /**
   * Auto-execute on Enter when selected in suggestions (vs just autocomplete)
   */
  autoExecute?: boolean
  /**
   * Argument completion provider for suggestions
   */
  completion?: (context: CommandContext, partialArg: string) => Promise<string[]> | string[]
  /**
   * Description shown in help
   */
  description: string
  /**
   * Command flags definition
   */
  flags?: CommandFlag[]
  /**
   * Hide from help and suggestions (e.g., for internal commands)
   */
  hidden?: boolean
  /**
   * Command kind indicates the source/type of command
   */
  kind: CommandKind
  /**
   * Primary command name (without leading slash)
   */
  name: string
  /**
   * Nested subcommands (e.g., /space list, /space switch)
   */
  subCommands?: SlashCommand[]
}
