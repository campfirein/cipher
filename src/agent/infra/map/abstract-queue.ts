import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

import {generateFileAbstracts} from './abstract-generator.js'

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
  private drainResolvers: Array<() => void> = []
  private failed = 0
  private generator: IContentGenerator | undefined
  private pending: QueueItem[] = []
  private processed = 0
  private processing = false
  /** Number of items currently in retry backoff (removed from pending but not yet re-enqueued). */
  private retrying = 0
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
    if (this.isIdle()) {
      await this.statusWritePromise.catch(() => {})
      return
    }

    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve)
      this.resolveDrainersIfIdle()
    })
  }

  /**
   * Add a file to the abstract generation queue.
   */
  enqueue(item: {contextPath: string; fullContent: string}): void {
    // Guard against paths that must never trigger abstract generation:
    // - derived artifacts (.abstract.md, .overview.md) — would produce .abstract.abstract.md
    // - summary index files (_index.md) — domain/topic summaries, not knowledge nodes
    const fileName = item.contextPath.split('/').at(-1) ?? item.contextPath
    if (
      fileName === '_index.md' ||
      item.contextPath.endsWith('.abstract.md') ||
      item.contextPath.endsWith('.overview.md')
    ) {
      return
    }

    this.pending.push({attempts: 0, contextPath: item.contextPath, fullContent: item.fullContent})
    this.queueStatusWrite()
    this.scheduleNext()
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
    if (!this.generator || this.processing || this.pending.length === 0) {
      this.resolveDrainersIfIdle()
      return
    }

    this.processing = true
    this.queueStatusWrite()

    const item = this.pending.shift()!

    try {
      const {abstractContent, overviewContent} = await generateFileAbstracts(
        item.fullContent,
        this.generator,
      )

      // Derive sibling paths: replace .md with .abstract.md and .overview.md
      const abstractPath = item.contextPath.replace(/\.md$/, '.abstract.md')
      const overviewPath = item.contextPath.replace(/\.md$/, '.overview.md')

      await Promise.all([
        writeFile(abstractPath, abstractContent, 'utf8'),
        writeFile(overviewPath, overviewContent, 'utf8'),
      ])

      this.processed++
    } catch {
      item.attempts++
      if (item.attempts < this.maxAttempts) {
        // Exponential backoff: 500ms, 1000ms, 2000ms, ...
        const delay = 500 * 2 ** (item.attempts - 1)
        this.retrying++
        this.queueStatusWrite()
        setTimeout(() => {
          this.retrying--
          this.pending.unshift(item)
          this.queueStatusWrite()
          this.scheduleNext()
        }, delay)
      } else {
        this.failed++
      }
    } finally {
      this.processing = false
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

    const resolvers = this.drainResolvers.splice(0)
    const settledStatusWrite = this.statusWritePromise.catch(() => {})
    for (const resolve of resolvers) {
      settledStatusWrite.then(() => resolve()).catch(() => {})
    }
  }

  private scheduleNext(): void {
    if (!this.generator || this.processing || this.pending.length === 0) {
      this.resolveDrainersIfIdle()
      return
    }

    // eslint-disable-next-line no-void
    setImmediate(() => { void this.processNext() })
  }

  private async writeStatusFile(): Promise<void> {
    const statusPath = join(this.projectRoot, '.brv', '_queue_status.json')
    try {
      await mkdir(join(this.projectRoot, '.brv'), {recursive: true})
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
