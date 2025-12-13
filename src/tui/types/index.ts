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
export type {ConfirmPromptRequest, PromptChoice, PromptRequest, SearchPromptRequest, SelectPromptRequest} from './prompts.js'

// UI types
export type {AuthState, QueueStats, Tab, TabId} from './ui.js'
