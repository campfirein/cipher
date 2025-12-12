/* eslint-disable perfectionist/sort-interfaces */
/**
 * Choice option for select prompts.
 */
export interface SelectChoice<T> {
  description?: string
  name: string
  value: T
}

/**
 * Search source function type.
 */
export type SearchSource<T> = (input: string | undefined) => Promise<SelectChoice<T>[]> | SelectChoice<T>[]

// ==================== Prompt Options ====================

/**
 * Options for confirm prompt.
 */
export interface ConfirmOptions {
  /** The default value (default: true) */
  default?: boolean
  /** The confirmation message */
  message: string
}

/**
 * Options for search prompt.
 */
export interface SearchOptions<T> {
  /** The prompt message */
  message: string
  /** Function that returns choices based on input */
  source: SearchSource<T>
}

/**
 * Options for select prompt.
 */
export interface SelectOptions<T> {
  /** The available choices */
  choices: SelectChoice<T>[]
  /** The prompt message */
  message: string
}

/**
 * Options for input prompt.
 */
export interface InputOptions {
  /** The prompt message */
  message: string
  /** Validation function (return true if valid, or error message string) */
  validate?: (value: string) => boolean | string
}

/**
 * File selector item representation.
 */
export interface FileSelectorItem {
  /** Whether the item is a directory */
  isDirectory: boolean
  /** The file/directory name */
  name: string
  /** The full path to the item */
  path: string
}

/**
 * Options for file selector prompt.
 */
export interface FileSelectorOptions {
  /** Allow user to cancel selection */
  allowCancel?: boolean
  /** Base path to start selection from */
  basePath: string
  /** Filter function to show/hide items */
  filter?: (item: Readonly<FileSelectorItem>) => boolean
  /** The prompt message */
  message: string
  /** Number of items to show per page */
  pageSize?: number
  /** Custom theme labels */
  theme?: {
    labels?: {
      messages?: {
        cancel?: string
        empty?: string
      }
    }
  }
  /** Type of items to select: 'directory' or 'file' */
  type?: 'directory' | 'file'
}

/**
 * Interface for terminal interactions.
 * Provides output and user input operations.
 */
export interface ITerminal {
  // ==================== Output ====================

  /**
   * Start a spinner/action indicator with a message.
   * @param message The message to display while action is in progress
   */
  actionStart(message: string): void

  /**
   * Stop the current spinner/action indicator.
   * @param message Optional message to display when stopped
   */
  actionStop(message?: string): void

  /**
   * Display a error message.
   * @param message The message to display
   */
  error(message: string): void

  /**
   * Display a message to the terminal.
   * @param message The message to display (optional, empty line if omitted)
   */
  log(message?: string): void

  /**
   * Display a warning message.
   * @param message The message to display
   */
  warn(message: string): void

  // ==================== Input ====================

  /**
   * Prompt the user for confirmation.
   * @param options Confirmation options
   * @returns Promise resolving to user's choice
   */
  confirm(options: ConfirmOptions): Promise<boolean>

  /**
   * Prompt the user to select a file or directory.
   * @param options File selector options
   * @returns Promise resolving to selected item, or null if cancelled
   */
  fileSelector(options: FileSelectorOptions): Promise<FileSelectorItem | null>

  /**
   * Prompt the user for text input.
   * @param options Input options
   * @returns Promise resolving to user's input string
   */
  input(options: InputOptions): Promise<string>

  /**
   * Prompt the user to search and select from options.
   * @param options Search options
   * @returns Promise resolving to selected value
   */
  search<T>(options: SearchOptions<T>): Promise<T>

  /**
   * Prompt the user to select from a list of choices.
   * @param options Select options
   * @returns Promise resolving to selected value
   */
  select<T>(options: SelectOptions<T>): Promise<T>
}
