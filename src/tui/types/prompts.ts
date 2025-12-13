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
 * Union of all prompt request types
 */
export type PromptRequest = ConfirmPromptRequest | SearchPromptRequest | SelectPromptRequest
