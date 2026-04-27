/**
 * Usage Logger — appends `llmservice:usage` events to a JSONL file.
 *
 * Per-LLM-call telemetry for token-usage analysis. One event per line.
 *
 * The file is rotated only by the user (delete or truncate); this logger
 * appends-only and creates the file on first write. No size cap, no
 * retention policy — appropriate for short-lived experimental runs.
 *
 * For production-grade telemetry (rotation, shipping, retention), this
 * is a starting point, not the final design.
 */

import {appendFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

import type {AgentEventBus} from '../../../agent/infra/events/event-emitter.js'

/**
 * Configuration for the usage logger.
 */
export interface UsageLoggerConfig {
  /**
   * Absolute path to the JSONL output file. Parent directories will be
   * created on first write if missing.
   */
  outputPath: string
}

/**
 * Subscribes to `llmservice:usage` events from an AgentEventBus and appends
 * each event's payload as a JSON-serialized line to a file.
 *
 * Lifecycle: instantiate, call `start(eventBus)` to subscribe, call `stop()`
 * to unsubscribe. Listener is a stable function reference so off() works.
 *
 * Failure mode: write failures are logged to console.error but do not throw —
 * losing telemetry should not crash the daemon. Out-of-order writes are
 * possible if events arrive while a previous append is in flight, but JSONL
 * tolerates that.
 */
export class UsageLogger {
  private eventBus?: AgentEventBus
  private listener?: (payload: Record<string, unknown>) => void
  private readonly outputPath: string
  private parentEnsured = false
  private subscribed = false

  public constructor(config: UsageLoggerConfig) {
    this.outputPath = config.outputPath
  }

  /**
   * Path the logger writes to (for diagnostics / tests).
   */
  public getOutputPath(): string {
    return this.outputPath
  }

  /**
   * Subscribe to `llmservice:usage` on the given event bus. Idempotent.
   */
  public start(eventBus: AgentEventBus): void {
    if (this.subscribed) return
    this.eventBus = eventBus
    this.listener = (payload: Record<string, unknown>) => {
      this.write(payload).catch((error: unknown) => {
         
        console.error('[UsageLogger] write failed:', error)
      })
    }

    eventBus.on('llmservice:usage', this.listener)
    this.subscribed = true
  }

  /**
   * Unsubscribe from the event bus. Idempotent.
   */
  public stop(): void {
    if (!this.subscribed || !this.eventBus || !this.listener) return
    this.eventBus.off('llmservice:usage', this.listener)
    this.subscribed = false
    this.listener = undefined
    this.eventBus = undefined
  }

  /**
   * Append a single event payload as a JSONL line. Creates the parent
   * directory on first call. Subsequent calls trust the directory exists.
   */
  private async write(payload: Record<string, unknown>): Promise<void> {
    if (!this.parentEnsured) {
      await mkdir(dirname(this.outputPath), {recursive: true})
      this.parentEnsured = true
    }

    const line = JSON.stringify(payload) + '\n'
    await appendFile(this.outputPath, line, 'utf8')
  }
}
