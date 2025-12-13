import {randomUUID} from 'node:crypto'

import type {
  ConfirmOptions,
  FileSelectorItem,
  FileSelectorOptions,
  InputOptions,
  ITerminal,
  SearchOptions,
  SelectOptions,
} from '../../core/interfaces/i-terminal.js'
import type {PromptRequest, StreamingMessage} from '../../tui/types.js'

/**
 * Generate a unique message ID
 */
function generateId(): string {
  return randomUUID()
}

/**
 * Callbacks for ReplTerminal operations.
 * These bridge the terminal to the TUI streaming system.
 */
export interface ReplTerminalCallbacks {
  /** Callback for streaming output messages */
  onMessage: (msg: StreamingMessage) => void
  /** Callback for interactive prompts */
  onPrompt: (prompt: PromptRequest) => void
}

/**
 * REPL-compatible ITerminal implementation.
 * Uses callbacks to integrate with TUI streaming and prompt system.
 */
export class ReplTerminal implements ITerminal {
  private currentActionId: null | string = null

  constructor(private readonly callbacks: ReplTerminalCallbacks) {}

  actionStart(message: string): void {
    // Generate a unique action ID to link start/stop
    this.currentActionId = generateId()
    this.callbacks.onMessage({
      actionId: this.currentActionId,
      content: message,
      id: generateId(),
      type: 'action_start',
    })
  }

  actionStop(message?: string): void {
    this.callbacks.onMessage({
      actionId: this.currentActionId ?? undefined,
      content: message ?? '',
      id: generateId(),
      type: 'action_stop',
    })
    this.currentActionId = null
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.callbacks.onPrompt({
        default: options.default,
        message: options.message,
        onResponse: resolve,
        type: 'confirm',
      })
    })
  }

  error(message: string): void {
    this.callbacks.onMessage({
      content: message,
      id: generateId(),
      type: 'error',
    })
  }

  fileSelector(options: FileSelectorOptions): Promise<FileSelectorItem | null> {
    return new Promise((resolve) => {
      this.callbacks.onPrompt({
        allowCancel: options.allowCancel,
        basePath: options.basePath,
        filter: options.filter,
        message: options.message,
        mode: options.type,
        onResponse: resolve as (value: null | {isDirectory: boolean; name: string; path: string}) => void,
        pageSize: options.pageSize,
        type: 'file_selector',
      })
    })
  }

  input(options: InputOptions): Promise<string> {
    return new Promise((resolve) => {
      this.callbacks.onPrompt({
        message: options.message,
        onResponse: resolve,
        type: 'input',
        validate: options.validate,
      })
    })
  }

  log(message?: string): void {
    this.callbacks.onMessage({
      content: message ?? '',
      id: generateId(),
      type: 'output',
    })
  }

  search<T>(options: SearchOptions<T>): Promise<T> {
    return new Promise((resolve) => {
      this.callbacks.onPrompt({
        message: options.message,
        onResponse: resolve as (value: unknown) => void,
        source: options.source as (
          input: string | undefined,
        ) => Array<{description?: string; name: string; value: unknown}>,
        type: 'search',
      })
    })
  }

  select<T>(options: SelectOptions<T>): Promise<T> {
    return new Promise((resolve) => {
      this.callbacks.onPrompt({
        choices: options.choices as Array<{description?: string; name: string; value: unknown}>,
        message: options.message,
        onResponse: resolve as (value: unknown) => void,
        type: 'select',
      })
    })
  }

  warn(message: string): void {
    this.callbacks.onMessage({
      content: message,
      id: generateId(),
      type: 'warning',
    })
  }
}
