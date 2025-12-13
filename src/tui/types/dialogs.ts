/**
 * Dialog request types for UI state management
 */

/**
 * Confirmation request stored in UI state (Gemini CLI pattern)
 * Used by DialogManager to render confirmation dialogs
 */
export interface ConfirmationRequest {
  onConfirm: (confirmed: boolean) => void
  prompt: string
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
