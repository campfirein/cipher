import {appendFileSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'

import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

import {generateFileAbstractsBatch} from './abstract-generator.js'

/**
 * Maximum files combined into a single batched L0/L1 LLM call.
 *
 * Two parallel calls fire per cycle: one L0 batch (~80 tok output × N files +
 * tags), one L1 batch (~1500 tok output × N files + tags). At N=5 the L1
 * output budget caps at ~8K tokens; raising N further risks output truncation
 * on smaller-context models. Lowering N reduces savings without quality gain.
 */
const BATCH_SIZE_CAP = 5

const QUEUE_TRACE_ENABLED = process.env.BRV_QUEUE_TRACE === '1'
const LOG_PATH = process.env.BRV_SESSION_LOG

function queueLog(message: string): void {
  if (!QUEUE_TRACE_ENABLED || !LOG_PATH) return
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} [abstract-queue] ${message}\n`)
  } catch {
    // ignore — tracing must never block queue progress
  }
}

/**
 * A queued item waiting for abstract generation.
 */
interface QueueItem {
  attempts: number
  contextPath: string
  fullContent: string
}

/**
 * Observable status of the abstract generation queue.
 */
export interface AbstractQueueStatus {
  failed: number
  pending: number
  processed: number
  processing: boolean
}

/**
 * Background queue for generating L0/L1 abstract files (.abstract.md, .overview.md).
 *
 * - Generator is injected lazily via setGenerator() (mirrors rebindMapTools pattern)
 * - Items arriving before setGenerator() are buffered and processed once generator is set
 * - Writes status to <projectRoot>/.brv/_queue_status.json after each state transition
 * - Retries up to maxAttempts with exponential backoff (500ms base)
 * - drain() waits for all pending/processing items to complete (for graceful shutdown)
 */
export class AbstractGenerationQueue {
  /**
   * When true, scheduleNext fires the next batch even if pending is below
   * BATCH_SIZE_CAP. Set by drain(); reset once the queue is fully idle.
   * Without this, items below the cap would be buffered indefinitely with
   * no flush trigger when a curate writes fewer files than the cap.
   */
  private drainRequested = false
  private drainResolvers: Array<() => void> = []
  private failed = 0
  private generator: IContentGenerator | undefined
  private onBeforeProcess?: () => Promise<void>
  private pending: QueueItem[] = []
  private processed = 0
  private processing = false
  /** Number of items currently in retry backoff (removed from pending but not yet re-enqueued). */
  private retrying = 0
  private statusDirCreated = false
  private statusWriteFailed = false
  private statusWritePromise: Promise<void> = Promise.resolve()

  constructor(
    private readonly projectRoot: string,
    private readonly maxAttempts = 3,
  ) {}

  /**
   * Wait for all pending items to finish processing (graceful shutdown).
   * Includes items currently in retry backoff so drain() does not resolve prematurely.
   */
  async drain(): Promise<void> {
    queueLog(`drain:start idle=${this.isIdle()} pending=${this.pending.length} retrying=${this.retrying} processing=${this.processing}`)
    // Force any buffered (below-cap) pending items to fire as a final batch.
    // scheduleNext respects drainRequested even when pending < BATCH_SIZE_CAP.
    this.drainRequested = true
    this.scheduleNext()

    if (this.isIdle()) {
      this.drainRequested = false
      await this.statusWritePromise.catch(() => {})
      queueLog('drain:resolved-immediate')
      return
    }

    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve)
      this.resolveDrainersIfIdle()
    })
    queueLog('drain:resolved-deferred')
  }

  /**
   * Add a file to the abstract generation queue.
   */
  enqueue(item: {contextPath: string; fullContent: string}): void {
    // Background batch writes derive .abstract.md / .overview.md from
    // contextPath via raw `writeFile`. A relative path would resolve under
    // process.cwd() rather than the intended context-tree location, and the
    // failure would be invisible because batch errors are catch-suppressed.
    // Drop misconfigured items at the entry point with a trace breadcrumb
    // rather than failing loudly — callers are internal and treat the queue
    // as fail-open.
    if (!isAbsolute(item.contextPath)) {
      queueLog(`enqueue:dropped non-absolute path=${item.contextPath}`)
      return
    }

    // Guard against paths that must never trigger abstract generation:
    // - derived artifacts (.abstract.md, .overview.md) — would produce .abstract.abstract.md
    // - summary index files (_index.md) — domain/topic summaries, not knowledge nodes
    // - hierarchy scaffolding (context.md) — helper files, not leaf knowledge entries
    const fileName = item.contextPath.split('/').at(-1) ?? item.contextPath
    if (
      fileName === 'context.md' ||
      fileName === '_index.md' ||
      item.contextPath.endsWith('.abstract.md') ||
      item.contextPath.endsWith('.overview.md')
    ) {
      return
    }

    this.pending.push({attempts: 0, contextPath: item.contextPath, fullContent: item.fullContent})
    queueLog(`enqueue path=${item.contextPath} pending=${this.pending.length} retrying=${this.retrying} processing=${this.processing}`)
    this.queueStatusWrite()
    // Buffer until cap is reached; drain() will trigger the final flush
    // for partial batches at curate-end. Without this gating, the first
    // enqueue starts a 1-item batch before the curate finishes writing
    // the rest of its files.
    if (this.pending.length >= BATCH_SIZE_CAP || this.drainRequested) {
      this.scheduleNext()
    }
  }

  /**
   * Return current queue status snapshot.
   */
  getStatus(): AbstractQueueStatus {
    return {
      failed: this.failed,
      // Items in retry backoff are still pending work — include them so the status
      // does not falsely report the queue as idle during backoff windows.
      pending: this.pending.length + this.retrying,
      processed: this.processed,
      processing: this.processing,
    }
  }

  /**
   * Set a callback that runs before each item is processed.
   * Used to refresh OAuth tokens before LLM calls.
   */
  setBeforeProcess(fn: () => Promise<void>): void {
    this.onBeforeProcess = fn
  }

  /**
   * Inject the LLM generator. Triggers processing of any buffered items.
   */
  setGenerator(generator: IContentGenerator): void {
    this.generator = generator
    this.scheduleNext()
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && !this.processing && this.retrying === 0
  }

  private async processNext(): Promise<void> {
    // Capture the generator in a local const so type narrowing survives the
    // `await` boundary below — TS won't keep `this.generator` narrow across
    // suspensions because another async path could reassign the property.
    const {generator} = this
    if (!generator || this.processing || this.pending.length === 0) {
      this.resolveDrainersIfIdle()
      return
    }

    this.processing = true
    this.queueStatusWrite()

    // Drain up to BATCH_SIZE_CAP items into a single batch. Items beyond the
    // cap stay pending for the next cycle. Note: `maxAttempts` counts BATCH
    // attempts for this item, not individual-call attempts — a transient
    // failure on attempt 1 consumes one retry token for every item in the
    // batch, including ones whose content was unrelated to the failure.
    // Acceptable: batches are small (cap=5) and the per-item re-enqueue on
    // batch failure preserves attempts independently across cycles.
    const batch = this.pending.splice(0, BATCH_SIZE_CAP)
    queueLog(`process:start batchSize=${batch.length} remaining=${this.pending.length} retrying=${this.retrying}`)

    try {
      // Refresh credentials before each generation (OAuth tokens may expire)
      try {
        await this.onBeforeProcess?.()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.debug(`[AbstractQueue] token refresh failed, proceeding with existing generator: ${msg}`)
      }

      const results = await generateFileAbstractsBatch(
        batch.map((it) => ({contextPath: it.contextPath, fullContent: it.fullContent})),
        generator,
      )

      // Write all batched outputs in parallel. Empty strings are valid (model
      // produced no content for that path) — preserves existing fail-open.
      await Promise.all(results.flatMap((r) => {
        const abstractPath = r.contextPath.replace(/\.md$/, '.abstract.md')
        const overviewPath = r.contextPath.replace(/\.md$/, '.overview.md')
        return [
          writeFile(abstractPath, r.abstractContent, 'utf8'),
          writeFile(overviewPath, r.overviewContent, 'utf8'),
        ]
      }))

      this.processed += batch.length
      queueLog(`process:success batchSize=${batch.length} processed=${this.processed}`)
    } catch (error) {
      // Batch-level failure → re-enqueue each item individually with its own
      // attempts counter, mirroring per-item retry semantics. Items past
      // maxAttempts count as failed.
      const msg = error instanceof Error ? error.message : String(error)
      const failedThisCycle: QueueItem[] = []
      const retryThisCycle: QueueItem[] = []
      for (const item of batch) {
        item.attempts++
        if (item.attempts < this.maxAttempts) {
          retryThisCycle.push(item)
        } else {
          this.failed++
          failedThisCycle.push(item)
          queueLog(`process:failed path=${item.contextPath} failed=${this.failed}`)
        }
      }

      console.debug(`[AbstractQueue] batch attempt failed (${msg}); retrying=${retryThisCycle.length}, exhausted=${failedThisCycle.length}`)

      for (const item of retryThisCycle) {
        const delay = 500 * 2 ** (item.attempts - 1)
        this.retrying++
        this.queueStatusWrite()
        setTimeout(() => {
          this.retrying--
          this.pending.unshift(item)
          queueLog(`process:retry-requeue path=${item.contextPath} pending=${this.pending.length} retrying=${this.retrying}`)
          this.queueStatusWrite()
          this.scheduleNext()
        }, delay)
      }
    } finally {
      this.processing = false
      queueLog(`process:finally batchSize=${batch.length} pending=${this.pending.length} retrying=${this.retrying} processed=${this.processed} failed=${this.failed}`)
      this.queueStatusWrite()
    }

    this.scheduleNext()
    this.resolveDrainersIfIdle()
  }

  private queueStatusWrite(): void {
    this.statusWritePromise = this.statusWritePromise
      .catch(() => {})
      .then(async () => this.writeStatusFile())
  }

  private resolveDrainersIfIdle(): void {
    if (!this.isIdle() || this.drainResolvers.length === 0) {
      return
    }

    // Reset drain state once the queue settles — next curate's enqueue burst
    // should buffer normally up to BATCH_SIZE_CAP again.
    this.drainRequested = false

    queueLog(`drain:idle pending=${this.pending.length} retrying=${this.retrying} processed=${this.processed} failed=${this.failed}`)
    const resolvers = this.drainResolvers.splice(0)
    const settledStatusWrite = this.statusWritePromise.catch(() => {})
    for (const resolve of resolvers) {
      settledStatusWrite.then(() => resolve()).catch(() => {})
    }
  }

  private scheduleNext(): void {
    if (!this.generator || this.processing) {
      return
    }

    if (this.pending.length === 0) {
      this.resolveDrainersIfIdle()
      return
    }

    // Buffer items below the cap unless drain has been requested (curate-end
    // signal). This keeps the queue from firing partial 1-item batches in the
    // middle of a multi-file curate.
    if (this.pending.length < BATCH_SIZE_CAP && !this.drainRequested) {
      return
    }

    // eslint-disable-next-line no-void
    setImmediate(() => { void this.processNext() })
  }

  private async writeStatusFile(): Promise<void> {
    const statusPath = join(this.projectRoot, '.brv', '_queue_status.json')
    try {
      if (!this.statusDirCreated) {
        await mkdir(join(this.projectRoot, '.brv'), {recursive: true})
        this.statusDirCreated = true
      }

      await writeFile(statusPath, JSON.stringify(this.getStatus()), 'utf8')
      this.statusWriteFailed = false
    } catch (error) {
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined
      if (errorCode === 'ENOENT') {
        return
      }

      if (!this.statusWriteFailed) {
        this.statusWriteFailed = true
        console.debug(
          `[AbstractGenerationQueue] Failed to write queue status: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  }
}
