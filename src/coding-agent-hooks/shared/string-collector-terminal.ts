/**
 * Shared terminal implementation for Claude Code hooks.
 *
 * Collects output as strings for non-interactive hook execution.
 * All input methods return default values since hooks run non-interactively.
 */
import type {FileSelectorItem, ITerminal} from '../../core/interfaces/i-terminal.js'

/**
 * Interface for output collection capabilities.
 * Extends ITerminal with methods to retrieve collected output.
 */
export interface IOutputCollector {
  /**
   * Clear all collected output.
   */
  clear(): void

  /**
   * Get all collected output as a single string.
   * @returns Concatenated output with newline separators
   */
  getOutput(): string
}

/**
 * Terminal implementation that collects output as strings.
 * Used by Claude Code hooks which run non-interactively.
 */
export class StringCollectorTerminal implements IOutputCollector, ITerminal {
  private output: string[] = []

  actionStart(): void {}

  actionStop(): void {}

  clear(): void {
    this.output = []
  }

  confirm(): Promise<boolean> {
    return Promise.resolve(false)
  }

  error(message: string): void {
    this.output.push(`Error: ${message}`)
  }

  fileSelector(): Promise<FileSelectorItem | null> {
    return Promise.resolve(null)
  }

  getOutput(): string {
    return this.output.join('\n')
  }

  input(): Promise<string> {
    return Promise.resolve('')
  }

  log(message?: string): void {
    if (message) {
      this.output.push(message)
    }
  }

  search<T>(): Promise<T> {
    return Promise.reject(new Error('Interactive search not supported in hook mode'))
  }

  select<T>(): Promise<T> {
    return Promise.reject(new Error('Interactive select not supported in hook mode'))
  }

  warn(message: string): void {
    this.output.push(`Warning: ${message}`)
  }
}
