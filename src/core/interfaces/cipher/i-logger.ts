/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 'debug',
  ERROR = 'error',
  INFO = 'info',
  WARN = 'warn',
}

/**
 * Logger interface for Clean Architecture compliance.
 *
 * This interface defines the contract for logging in the application.
 * Domain and infrastructure layers should depend on this interface,
 * not on concrete logging implementations.
 *
 * Design principles:
 * - No dependencies on external libraries (console, winston, etc.)
 * - Simple, focused API for common logging needs
 * - Supports structured logging with context objects
 *
 * @example
 * ```typescript
 * class MyService {
 *   constructor(private readonly logger: ILogger) {}
 *
 *   async doWork(): Promise<void> {
 *     this.logger.info('Starting work', { taskId: '123' });
 *     try {
 *       // ... work ...
 *       this.logger.debug('Work completed', { duration: 100 });
 *     } catch (error) {
 *       this.logger.error('Work failed', { error });
 *     }
 *   }
 * }
 * ```
 */
export interface ILogger {
  /**
   * Log a debug message (verbose, for development).
   *
   * @param message - Human-readable message
   * @param context - Optional structured context data
   */
  debug(message: string, context?: Record<string, unknown>): void

  /**
   * Log an error message (for failures and exceptions).
   *
   * @param message - Human-readable error message
   * @param context - Optional structured context data (e.g., error object, stack trace)
   */
  error(message: string, context?: Record<string, unknown>): void

  /**
   * Log an info message (general informational).
   *
   * @param message - Human-readable message
   * @param context - Optional structured context data
   */
  info(message: string, context?: Record<string, unknown>): void

  /**
   * Log a warning message (potential issues).
   *
   * @param message - Human-readable warning message
   * @param context - Optional structured context data
   */
  warn(message: string, context?: Record<string, unknown>): void
}

/**
 * No-op logger implementation that discards all log messages.
 * Useful for testing or when logging is disabled.
 */
export class NoOpLogger implements ILogger {
  debug(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  error(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }
}
