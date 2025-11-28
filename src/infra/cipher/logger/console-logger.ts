import chalk from 'chalk'

import type {ILogger} from '../../../core/interfaces/cipher/i-logger.js'

/**
 * Console-based logger implementation.
 *
 * This is a concrete logger that writes to the console with color formatting.
 * Used at the command/presentation layer to display logs to the user.
 *
 * Design principles:
 * - Only used in command layer (not in domain/infrastructure)
 * - Formats messages with chalk for better UX
 * - Includes timestamps for debugging
 * - Can be swapped with other implementations (file, remote, etc.)
 *
 * @example
 * ```typescript
 * const logger = new ConsoleLogger({ verbose: true });
 * logger.info('Server started', { port: 3000 });
 * // Output: [2025-01-26 10:30:45] INFO: Server started {"port":3000}
 * ```
 */
export class ConsoleLogger implements ILogger {
  private readonly verbose: boolean

  /**
   * Create a new console logger.
   *
   * @param options - Logger options
   * @param options.verbose - Enable verbose (debug) output
   */
  constructor(options: {verbose?: boolean} = {}) {
    this.verbose = options.verbose ?? false
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.verbose) return

    const timestamp = this.formatTimestamp()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    console.log(chalk.gray(`[${timestamp}] DEBUG: ${message}${contextStr}`))
  }

  error(message: string, context?: Record<string, unknown>): void {
    const timestamp = this.formatTimestamp()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    console.error(chalk.red(`[${timestamp}] ERROR: ${message}${contextStr}`))
  }

  info(message: string, context?: Record<string, unknown>): void {
    const timestamp = this.formatTimestamp()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    console.log(chalk.cyan(`[${timestamp}] INFO: ${message}${contextStr}`))
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const timestamp = this.formatTimestamp()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    console.warn(chalk.yellow(`[${timestamp}] WARN: ${message}${contextStr}`))
  }

  /**
   * Format current timestamp for log messages.
   *
   * @returns Formatted timestamp string (YYYY-MM-DD HH:MM:SS)
   */
  private formatTimestamp(): string {
    const now = new Date()
    return now.toISOString().replace('T', ' ').slice(0, 19)
  }
}
