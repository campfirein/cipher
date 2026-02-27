import {randomUUID} from 'node:crypto'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MapProgress {
  failed: number
  mapId: string
  running: number
  succeeded: number
  total: number
}

export interface MapRunResult {
  failed: number
  mapId: string
  succeeded: number
  total: number
}

export interface InMemoryMapRunResult extends MapRunResult {
  /** Per-item results keyed by input index */
  results: Map<number, unknown>
}

export interface WorkerPoolOptions {
  /** Abort signal to cancel all workers */
  abortSignal?: AbortSignal
  /** Number of parallel workers */
  concurrency: number
  /** Pre-loaded items from JSONL input */
  items: unknown[]
  /** Progress callback for streaming updates */
  onProgress?: (progress: MapProgress) => void
  /** Function to process a single item. Must return the result or throw. */
  processItem: (index: number, item: unknown) => Promise<unknown>
}

// ── Worker Pool ──────────────────────────────────────────────────────────────

/**
 * In-memory parallel worker pool for map operations.
 *
 * N workers run in parallel via Promise.all(). Each worker claims items by
 * incrementing a shared index counter (safe because JS is single-threaded
 * for synchronous code — no cross-process races).
 *
 * Replaces the previous FileMapStore-backed implementation which used atomic
 * file renames for item claiming. That pattern was ported from VoltCode's
 * multi-process PostgreSQL architecture but is unnecessary for byterover-cli's
 * single-process execution model.
 *
 * @returns Summary of the map run including a results Map (index → result)
 */
export async function runMapWorkerPool(options: WorkerPoolOptions): Promise<InMemoryMapRunResult> {
  const {abortSignal, concurrency, items, onProgress, processItem} = options

  const mapId = `map-${Date.now()}-${randomUUID().slice(0, 8)}`
  const total = items.length
  const results = new Map<number, unknown>()

  let succeededCount = 0
  let failedCount = 0
  let runningCount = 0
  let nextIndex = 0

  function emitProgress(): void {
    onProgress?.({
      failed: failedCount,
      mapId,
      running: runningCount,
      succeeded: succeededCount,
      total,
    })
  }

  /**
   * Single worker: claims items by incrementing the shared index until
   * the queue is exhausted or the abort signal fires.
   */
  async function runWorker(): Promise<void> {
    while (!abortSignal?.aborted) {
      const idx = nextIndex++
      if (idx >= items.length) {
        break
      }

      runningCount++
      emitProgress()

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await processItem(idx, items[idx])
        results.set(idx, result)
        succeededCount++
      } catch {
        // Store null placeholder so output JSONL maintains 1:1 line mapping with input
        results.set(idx, null)
        failedCount++
      }

      runningCount--
      emitProgress()
    }
  }

  // Launch worker pool — N workers run in parallel
  const workerCount = Math.min(concurrency, total || concurrency)
  const workers = Array.from({length: workerCount}, () => runWorker())
  await Promise.all(workers)

  return {
    failed: failedCount,
    mapId,
    results,
    succeeded: succeededCount,
    total,
  }
}
