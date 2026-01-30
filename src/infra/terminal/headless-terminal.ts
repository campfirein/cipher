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

import {HeadlessPromptError} from '../../core/domain/errors/headless-prompt-error.js'

/**
 * Output format for headless terminal.
 * - 'text': Human-readable text output
 * - 'json': NDJSON (newline-delimited JSON) for machine parsing
 */
export type HeadlessOutputFormat = 'json' | 'text'

/**
 * JSON message types for structured output.
 */
export type HeadlessMessageType = 'action_start' | 'action_stop' | 'error' | 'log' | 'result' | 'warning'

/**
 * Structured JSON output message.
 */
export interface HeadlessJsonMessage {
  actionId?: string
  id: string
  message: string
  timestamp: string
  type: HeadlessMessageType
}

/**
 * Options for creating a HeadlessTerminal.
 */
export interface HeadlessTerminalOptions {
  /**
   * Stream for errors (defaults to process.stderr).
   */
  errorStream?: NodeJS.WritableStream
  /**
   * If true, throw HeadlessPromptError when a prompt cannot be answered.
   * If false, use sensible defaults (first choice, false for confirm, etc.)
   * @default true
   */
  failOnPrompt?: boolean
  /**
   * Output format: 'text' for human readable, 'json' for machine parsing.
   * @default 'text'
   */
  outputFormat?: HeadlessOutputFormat
  /**
   * Stream for output (defaults to process.stdout).
   */
  outputStream?: NodeJS.WritableStream
  /**
   * Default values for prompts, keyed by prompt message or prompt type.
   * Used to answer prompts automatically in headless mode.
   */
  promptDefaults?: Record<string, unknown>
}

/**
 * Terminal implementation for headless/non-interactive mode.
 * Outputs to stdout/stderr and handles prompts via defaults or fails gracefully.
 */
export class HeadlessTerminal implements ITerminal {
  private currentActionId: null | string = null
  private readonly errorOutput: NodeJS.WritableStream
  private readonly failOnPrompt: boolean
  private readonly output: NodeJS.WritableStream
  private readonly outputFormat: HeadlessOutputFormat
  private readonly promptDefaults: Record<string, unknown>

  constructor(options: HeadlessTerminalOptions = {}) {
    this.outputFormat = options.outputFormat ?? 'text'
    this.promptDefaults = options.promptDefaults ?? {}
    this.failOnPrompt = options.failOnPrompt ?? true
    this.output = options.outputStream ?? process.stdout
    this.errorOutput = options.errorStream ?? process.stderr
  }

  // ==================== Output Methods ====================

  actionStart(message: string): void {
    this.currentActionId = randomUUID()
    if (this.outputFormat === 'json') {
      this.writeJson({
        actionId: this.currentActionId,
        id: randomUUID(),
        message,
        timestamp: new Date().toISOString(),
        type: 'action_start',
      })
    }
    // In text mode, suppress action start for cleaner output
  }

  actionStop(message?: string): void {
    if (this.outputFormat === 'json' && this.currentActionId) {
      this.writeJson({
        actionId: this.currentActionId,
        id: randomUUID(),
        message: message ?? '',
        timestamp: new Date().toISOString(),
        type: 'action_stop',
      })
    }

    this.currentActionId = null
  }

  async confirm(options: ConfirmOptions): Promise<boolean> {
    // Check for explicit default in promptDefaults
    const defaultValue = this.getDefault('confirm', options.message)
    if (defaultValue !== undefined) {
      return Boolean(defaultValue)
    }

    // Use options.default if provided
    if (options.default !== undefined) {
      return options.default
    }

    // Fail or return false
    if (this.failOnPrompt) {
      throw new HeadlessPromptError('confirm', options.message)
    }

    return false
  }

  error(message: string): void {
    if (this.outputFormat === 'json') {
      this.writeJson({
        id: randomUUID(),
        message,
        timestamp: new Date().toISOString(),
        type: 'error',
      })
    } else {
      this.errorOutput.write(`Error: ${message}\n`)
    }
  }

  async fileSelector(options: FileSelectorOptions): Promise<FileSelectorItem | null> {
    // Check for explicit default in promptDefaults
    const defaultValue = this.getDefault('file_selector', options.message)
    if (defaultValue !== undefined && typeof defaultValue === 'string') {
      return {
        isDirectory: options.type === 'directory',
        name: defaultValue.split('/').pop() ?? defaultValue,
        path: defaultValue,
      }
    }

    // Allow cancel if specified
    if (options.allowCancel) {
      return null
    }

    // Fail
    if (this.failOnPrompt) {
      throw new HeadlessPromptError('file_selector', options.message)
    }

    return null
  }

  // ==================== Input Methods ====================

  async input(options: InputOptions): Promise<string> {
    // Check for explicit default in promptDefaults
    const defaultValue = this.getDefault('input', options.message)
    if (defaultValue !== undefined) {
      const value = String(defaultValue)
      // Validate if validator is provided
      if (options.validate) {
        const validationResult = options.validate(value)
        if (validationResult !== true) {
          const errorMsg = typeof validationResult === 'string' ? validationResult : 'Validation failed'
          throw new HeadlessPromptError('input', `${options.message} (validation error: ${errorMsg})`)
        }
      }

      return value
    }

    // Fail
    if (this.failOnPrompt) {
      throw new HeadlessPromptError('input', options.message)
    }

    return ''
  }

  log(message?: string): void {
    if (this.outputFormat === 'json') {
      this.writeJson({
        id: randomUUID(),
        message: message ?? '',
        timestamp: new Date().toISOString(),
        type: 'log',
      })
    } else {
      this.output.write((message ?? '') + '\n')
    }
  }

  async search<T>(options: SearchOptions<T>): Promise<T> {
    // Search prompts require user interaction - always fail in headless mode
    // unless a default is explicitly provided
    const defaultValue = this.getDefault('search', options.message)
    if (defaultValue !== undefined) {
      return defaultValue as T
    }

    throw new HeadlessPromptError('search', options.message)
  }

  async select<T>(options: SelectOptions<T>): Promise<T> {
    // Check for explicit default in promptDefaults (by value or name)
    const defaultValue = this.getDefault('select', options.message)
    if (defaultValue !== undefined) {
      const choice = options.choices.find((c) => c.value === defaultValue || c.name === defaultValue)
      if (choice) {
        return choice.value
      }
    }

    // Fail or return first choice
    if (this.failOnPrompt) {
      throw new HeadlessPromptError(
        'select',
        options.message,
        options.choices.map((c) => c.name),
      )
    }

    // Return first choice as fallback
    if (options.choices.length > 0) {
      return options.choices[0].value
    }

    throw new HeadlessPromptError('select', options.message, [])
  }

  warn(message: string): void {
    if (this.outputFormat === 'json') {
      this.writeJson({
        id: randomUUID(),
        message,
        timestamp: new Date().toISOString(),
        type: 'warning',
      })
    } else {
      this.errorOutput.write(`Warning: ${message}\n`)
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Write final response with success/error status.
   */
  writeFinalResponse(response: {command: string; data?: unknown; error?: {code: string; message: string}; success: boolean}): void {
    if (this.outputFormat === 'json') {
      this.output.write(
        JSON.stringify({
          ...response,
          timestamp: new Date().toISOString(),
        }) + '\n',
      )
    }
  }

  /**
   * Write final result in JSON format (convenience method for commands).
   */
  writeResult(data: Record<string, unknown>): void {
    if (this.outputFormat === 'json') {
      this.writeJson({
        id: randomUUID(),
        message: JSON.stringify(data),
        timestamp: new Date().toISOString(),
        type: 'result',
      })
    }
  }

  private getDefault(promptType: string, promptMessage: string): undefined | unknown {
    // First check by exact message
    if (this.promptDefaults[promptMessage] !== undefined) {
      return this.promptDefaults[promptMessage]
    }

    // Then check by prompt type
    if (this.promptDefaults[promptType] !== undefined) {
      return this.promptDefaults[promptType]
    }

    return undefined
  }

  private writeJson(data: HeadlessJsonMessage): void {
    this.output.write(JSON.stringify(data) + '\n')
  }
}
