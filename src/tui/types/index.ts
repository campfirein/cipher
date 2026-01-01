/**
 * TUI Shared Types
 *
 * Re-exports all types from individual modules for backwards compatibility.
 */

// Command types
export {CommandKind} from './commands.js'

export type {
  ClearActionReturn,
  CommandArg,
  CommandContext,
  CommandFlag,
  CommandSubcommandInfo,
  CommandSuggestion,
  ConfirmActionReturn,
  CurateDialogActionReturn,
  CustomDialogActionReturn,
  MessageActionReturn,
  QueryDialogActionReturn,
  QuitActionReturn,
  SlashCommand,
  SlashCommandActionReturn,
  StreamingActionReturn,
  SubmitPromptReturn,
} from './commands.js'

// Dialog types
export type {
  ConfirmationRequest,
  CurateContextInputRequest,
  CurateDialogRequest,
  QueryDialogRequest,
} from './dialogs.js'
// Message types
export type {ActivityLog, CommandMessage, Message, StreamingMessage} from './messages.js'

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
export type {AuthState, ConsumerStatus, Tab, TabId, TaskStats} from './ui.js'
