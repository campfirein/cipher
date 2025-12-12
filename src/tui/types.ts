/**
 * TUI Shared Types
 */

import type React from 'react'

export type AuthState = 'authorized' | 'checking' | 'unauthorized'

export type TabId = 'activity' | 'console'

export interface Tab {
  id: TabId
  label: string
}

export interface QueueStats {
  pending: number
  processing: number
}

/**
 * Message type for displaying in message list
 */
export interface Message {
  content: string
  timestamp?: Date
  type: 'command' | 'error' | 'info' | 'success' | 'system'
}

export interface CommandMessage extends Message {
  fromCommand: string
  /** Streaming output associated with this command */
  output?: StreamingMessage[]
}

/**
 * Activity log item for displaying in logs view
 */
import type {ExecutionStatus, ToolCallStatus} from '../core/domain/cipher/queue/types.js'

export interface ActivityLog {
  changes: {created: string[]; updated: string[]}
  content: string
  id: string
  input: string
  progress?: Array<{id: string; status: ToolCallStatus; toolCallName: string}>
  source?: string
  status: ExecutionStatus
  timestamp: Date
  type: 'curate' | 'query'
}

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
 * Confirmation request stored in UI state (Gemini CLI pattern)
 * Used by DialogManager to render confirmation dialogs
 */
export interface ConfirmationRequest {
  onConfirm: (confirmed: boolean) => void
  prompt: string
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
 * Query dialog request stored in UI state
 * Used to render the query input dialog
 */
export interface QueryDialogRequest {
  onCancel: () => void
  onSubmit: (query: string) => void
}

/**
 * Command action return type for showing curate option dialog
 */
export interface CurateDialogActionReturn {
  type: 'curate_dialog'
}

/**
 * Curate option dialog request stored in UI state
 * Used to render the curate mode selection dialog
 */
export interface CurateDialogRequest {
  onCancel: () => void
  onSelectContextInput: () => void
  onSelectInteractive: () => void
}

/**
 * Curate context input dialog request stored in UI state
 * Used to render the context input dialog for autonomous curating
 */
export interface CurateContextInputRequest {
  onCancel: () => void
  onSubmit: (context: string) => void
  onToggleMode?: () => void
}

/**
 * Individual streaming message for real-time output
 */
export interface StreamingMessage {
  /** Message content */
  content: string
  /** Unique identifier */
  id: string
  /** Tool execution status (for tool_start/tool_end types) */
  status?: 'error' | 'executing' | 'success'
  /** Tool name (for tool_start/tool_end types) */
  toolName?: string
  /** Type of streaming message */
  type: 'error' | 'output' | 'tool_end' | 'tool_start' | 'warning'
}

/**
 * Choice option for prompt selections
 */
export interface PromptChoice<T = unknown> {
  description?: string
  name: string
  value: T
}

/**
 * Prompt request for searchable selection
 */
export interface SearchPromptRequest<T = unknown> {
  /** The prompt message */
  message: string
  /** Callback when user selects a value */
  onResponse: (value: T) => void
  /** Function that returns choices based on search input */
  source: (input: string | undefined) => Array<PromptChoice<T>> | Promise<Array<PromptChoice<T>>>
  type: 'search'
}

/**
 * Prompt request for yes/no confirmation
 */
export interface ConfirmPromptRequest {
  /** Default value (default: true) */
  default?: boolean
  /** The prompt message */
  message: string
  /** Callback when user responds */
  onResponse: (value: boolean) => void
  type: 'confirm'
}

/**
 * Prompt request for selection from choices
 */
export interface SelectPromptRequest<T = unknown> {
  /** Available choices */
  choices: Array<PromptChoice<T>>
  /** The prompt message */
  message: string
  /** Callback when user selects a value */
  onResponse: (value: T) => void
  type: 'select'
}

/**
 * Union of all prompt request types
 */
export type PromptRequest = ConfirmPromptRequest | SearchPromptRequest | SelectPromptRequest

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
  | StreamingActionReturn
  | SubmitPromptReturn
  | void

/**
 * Context passed to command action functions
 */
export interface CommandContext {
  /**
   * Invocation details about the current command execution
   */
  invocation?: {
    /** Arguments passed to the command */
    args: string
    /** Resolved command name */
    name: string
    /** Full raw input string */
    raw: string
  }
  /**
   * All loaded slash commands (for help command, etc.)
   */
  slashCommands?: readonly SlashCommand[]
  /**
   * UI operations available to commands
   */
  ui?: {
    /**
     * Add a message to the message history
     */
    addMessage: (msg: Message) => void
    /**
     * Clear all messages from the history
     */
    clearMessages: () => void
    /**
     * Remove the currently displayed custom dialog
     */
    removeDialog: () => void
    /**
     * Set processing state
     */
    setIsProcessing: (processing: boolean) => void
  }
  /**
   * CLI version
   */
  version?: string
}

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

/**
 * Suggestion item for auto-completion
 */
export interface CommandSuggestion {
  /** Command kind for styling */
  commandKind?: CommandKind
  /** Optional description */
  description?: string
  /** Display label */
  label: string
  /** Value to insert on selection */
  value: string
}
