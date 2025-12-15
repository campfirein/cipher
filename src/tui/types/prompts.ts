/**
 * Prompt types for inline interactive prompts
 */

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
 * Prompt request for text input with validation
 */
export interface InputPromptRequest {
  /** The prompt message */
  message: string
  /** Callback when user submits */
  onResponse: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  type: 'input'
  /** Validation function - return true if valid, or error message string */
  validate?: (value: string) => boolean | string
}

/**
 * File selector item representation
 */
export interface FileSelectorItemResult {
  /** Whether the item is a directory */
  isDirectory: boolean
  /** The file/directory name */
  name: string
  /** The full path to the item */
  path: string
}

/**
 * Selection mode for file selector
 */
export type FileSelectorMode = 'directory' | 'file'

/**
 * Prompt request for file/directory selection with tree navigation
 */
export interface FileSelectorPromptRequest {
  /** Allow user to cancel selection */
  allowCancel?: boolean
  /** Base path to start from (cannot navigate above this) */
  basePath: string
  /** Filter function to show/hide items */
  filter?: (item: FileSelectorItemResult) => boolean
  /** The prompt message */
  message: string
  /** Selection mode: 'file' or 'directory' (default: 'file') */
  mode?: FileSelectorMode
  /** Callback when user selects or cancels */
  onResponse: (value: FileSelectorItemResult | null) => void
  /** Number of items visible at once */
  pageSize?: number
  type: 'file_selector'
}

/**
 * Union of all prompt request types
 */
export type PromptRequest =
  | ConfirmPromptRequest
  | FileSelectorPromptRequest
  | InputPromptRequest
  | SearchPromptRequest
  | SelectPromptRequest
