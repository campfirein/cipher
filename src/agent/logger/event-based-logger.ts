import type {ILogger} from '../interfaces/i-logger.js'
import type {AgentEventBus} from '../events/event-emitter.js'

/**
 * Event-based logger that emits cipher:log events instead of writing directly.
 *
 * This follows Clean Architecture by decoupling logging from infrastructure.
 * The logger emits events that can be handled by any listener (console, file, remote, etc.).
 *
 * Design principles:
 * - Domain/infrastructure layers use this logger
 * - Events are emitted to AgentEventBus
 * - Command layer listens to events and decides how to handle them
 * - Supports optional source and sessionId for context tracking
 *
 * @example
 * ```typescript
 * const logger = new EventBasedLogger(agentBus, 'MyService');
 * logger.info('User logged in', { userId: '123' });
 * // Emits: cipher:log { level: 'info', message: '...', source: 'MyService', ... }
 * ```
 */
export class EventBasedLogger implements ILogger {
  /**
   * Create a new event-based logger.
   *
   * @param eventBus - Agent event bus to emit log events to
   * @param source - Optional source identifier (e.g., class name)
   * @param sessionId - Optional session ID for session-scoped logs
   */
  constructor(
    private readonly eventBus: AgentEventBus,
    private readonly source?: string,
    private readonly sessionId?: string,
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.eventBus.emit('cipher:log', {
      context,
      level: 'debug',
      message,
      sessionId: this.sessionId,
      source: this.source,
    })
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.eventBus.emit('cipher:log', {
      context,
      level: 'error',
      message,
      sessionId: this.sessionId,
      source: this.source,
    })
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.eventBus.emit('cipher:log', {
      context,
      level: 'info',
      message,
      sessionId: this.sessionId,
      source: this.source,
    })
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.eventBus.emit('cipher:log', {
      context,
      level: 'warn',
      message,
      sessionId: this.sessionId,
      source: this.source,
    })
  }

  /**
   * Create a child logger with a different session ID.
   * Useful for creating session-scoped loggers.
   *
   * @param sessionId - Session ID for the child logger
   * @returns New logger instance with the specified session ID
   */
  withSessionId(sessionId: string): EventBasedLogger {
    return new EventBasedLogger(this.eventBus, this.source, sessionId)
  }

  /**
   * Create a child logger with a different source.
   * Useful for creating component-scoped loggers.
   *
   * @param source - Source identifier for the child logger
   * @returns New logger instance with the specified source
   */
  withSource(source: string): EventBasedLogger {
    return new EventBasedLogger(this.eventBus, source, this.sessionId)
  }
}
