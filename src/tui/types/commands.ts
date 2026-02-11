/**
 * Command-related types
 */

import type React from 'react'

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
 * Command action return type for displaying a message (used for errors)
 */
export interface MessageActionReturn {
  content: string
  messageType: 'error' | 'info'
  type: 'message'
}

/**
 * Side effects that a command can request after completion.
 * The command executor processes these generically instead of
 * hardcoding behavior per command name.
 */
export interface CommandSideEffects {
  /** Clear the current session (messages, tasks) */
  clearSession?: boolean
  /** Mark init-provider onboarding step as complete (transitions to curate) */
  completeInitProvider?: boolean
  /** Reload auth state from token store */
  reloadAuth?: boolean
  /** Reload project config (.brv/config.json) */
  reloadConfig?: boolean
  /** Restart the agent process with the given reason */
  restartAgent?: {reason: string}
}

/**
 * Callbacks provided to custom dialog components by the command executor.
 */
export interface CustomDialogCallbacks {
  /** Signal that the dialog was cancelled */
  onCancel: () => void
  /** Signal that the dialog completed with a result message */
  onComplete: (message: string, sideEffects?: CommandSideEffects) => void
}

/**
 * Command action return type for rendering a custom dialog component.
 * Uses a render function so the command executor can inject lifecycle callbacks.
 */
export interface CustomDialogActionReturn {
  render: (callbacks: CustomDialogCallbacks) => React.ReactNode
}

/**
 * Union of all possible command action return types
 */
export type SlashCommandActionReturn = CustomDialogActionReturn | MessageActionReturn | void

/**
 * Slash command definition
 * Supports nested subcommands, auto-completion, and flexible action returns
 */
export interface SlashCommand {
  /**
   * Action function that executes the command
   * Optional for commands that only have subcommands
   */
  action?: (context: CommandContext, args: string) => Promise<SlashCommandActionReturn> | SlashCommandActionReturn
  /**
   * Command arguments definition
   */
  args?: CommandArg[]
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
   * Primary command name (without leading slash)
   */
  name: string
  /**
   * Nested subcommands (e.g., /space list, /space switch)
   */
  subCommands?: SlashCommand[]
}
