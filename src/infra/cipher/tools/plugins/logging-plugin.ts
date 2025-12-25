import type { ToolExecutionResult } from '../../../../core/domain/cipher/tools/tool-error.js'
import type { ILogger } from '../../../../core/interfaces/cipher/i-logger.js'
import type {
  BeforeHookResult,
  IToolPlugin,
  ToolHookContext,
} from '../../../../core/interfaces/cipher/i-tool-plugin.js'

/**
 * Example plugin that logs tool execution.
 *
 * Demonstrates how to implement the IToolPlugin interface
 * for logging/auditing purposes.
 *
 * @example
 * ```typescript
 * const logger = createLogger('tools')
 * const loggingPlugin = new LoggingPlugin(logger)
 * pluginManager.register(loggingPlugin)
 * ```
 */
export class LoggingPlugin implements IToolPlugin {
  public readonly name = 'logging'
  public readonly priority = 1 // Execute early to capture all events
  private readonly logger: ILogger

  public constructor(logger: ILogger) {
    this.logger = logger
  }

  public afterExecute(
    ctx: ToolHookContext,
    _args: Record<string, unknown>,
    result: ToolExecutionResult
  ): void {
    const duration = result.metadata?.durationMs ?? 'unknown'

    if (result.success) {
      this.logger.debug(`[Tool] ${ctx.toolName} completed in ${duration}ms`, {
        callId: ctx.callId,
        sessionId: ctx.sessionId,
      })
    } else {
      this.logger.warn(`[Tool] ${ctx.toolName} failed in ${duration}ms: ${result.errorMessage}`, {
        callId: ctx.callId,
        errorType: result.errorType,
        sessionId: ctx.sessionId,
      })
    }
  }

  public beforeExecute(
    ctx: ToolHookContext,
    args: Record<string, unknown>
  ): BeforeHookResult {
    this.logger.debug(`[Tool] ${ctx.toolName} starting`, {
      args: this.sanitizeArgs(args),
      callId: ctx.callId,
      sessionId: ctx.sessionId,
    })

    return { proceed: true }
  }

  /**
   * Sanitize args for logging (truncate large values, redact sensitive data).
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {}
    const maxLength = 200

    for (const [key, value] of Object.entries(args)) {
      // Redact potentially sensitive fields
      if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
        sanitized[key] = '[REDACTED]'
        continue
      }

      // Truncate long strings
      if (typeof value === 'string' && value.length > maxLength) {
        sanitized[key] = `${value.slice(0, maxLength)}... (${value.length} chars)`
        continue
      }

      sanitized[key] = value
    }

    return sanitized
  }
}
