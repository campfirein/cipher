/**
 * TUI Shared Types
 *
 * Re-exports all types from individual modules for backwards compatibility.
 */

// Command types
export type {
  CommandArg,
  CommandContext,
  CommandFlag,
  CommandSideEffects,
  CommandSubcommandInfo,
  CommandSuggestion,
  CustomDialogActionReturn,
  CustomDialogCallbacks,
  MessageActionReturn,
  SlashCommand,
  SlashCommandActionReturn,
} from './commands.js'

// Dialog types
export type {
  ConfirmationRequest,
  CurateContextInputRequest,
  CurateDialogRequest,
  QueryDialogRequest,
} from './dialogs.js'
// Message types
export type {
  ActivityLog,
  CommandMessage,
  ExecutionStatus,
  Message,
  StreamingMessage,
  ToolCallStatus,
} from './messages.js'

// Prompt types
export type {
  ConfirmPromptRequest,
  FileSelectorItemResult,
  FileSelectorMode,
  FileSelectorPromptRequest,
  InputPromptRequest,
  PromptChoice,
  PromptRequest,
  SearchPromptRequest,
  SelectPromptRequest,
} from './prompts.js'

// Status types
export {STATUS_DISMISS_TIMES} from './status.js'
export type {StatusEvent, StatusEventType} from './status.js'

// UI types
export type {AuthState, ConsumerStatus, TaskStats} from './ui.js'
