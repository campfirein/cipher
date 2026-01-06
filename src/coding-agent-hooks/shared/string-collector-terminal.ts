/**
 * Shared terminal implementation for Claude Code hooks.
 *
 * Collects output as strings for non-interactive hook execution.
 * All input methods return default values since hooks run non-interactively.
 */
import type {FileSelectorItem, ITerminal} from '../../core/interfaces/i-terminal.js'

/**
 * Terminal implementation that collects output as strings.
 * Used by Claude Code hooks which run non-interactively.
 */
export class StringCollectorTerminal implements ITerminal {
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
