import {randomUUID} from 'node:crypto'
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {CurateLogEntry} from '../../core/domain/entities/curate-log-entry.js'
import type {ICurateLogStore} from '../../core/interfaces/storage/i-curate-log-store.js'

import {CURATE_LOG_DIR, CURATE_LOG_ID_PREFIX} from '../../constants.js'

// ── Zod schema for file validation ────────────────────────────────────────────

const CurateLogOperationFileSchema = z.object({
  filePath: z.string().optional(),
  message: z.string().optional(),
  path: z.string(),
  status: z.enum(['failed', 'success']),
  type: z.enum(['ADD', 'DELETE', 'MERGE', 'UPDATE', 'UPSERT']),
})

const CurateLogSummaryFileSchema = z.object({
  added: z.number(),
  deleted: z.number(),
  failed: z.number(),
  merged: z.number(),
  updated: z.number(),
})

const CurateLogEntryBaseSchema = z.object({
  id: z.string(),
  input: z.object({
    context: z.string().optional(),
    files: z.array(z.string()).optional(),
    folders: z.array(z.string()).optional(),
  }),
  operations: z.array(CurateLogOperationFileSchema),
  startedAt: z.number(),
  summary: CurateLogSummaryFileSchema,
  taskId: z.string(),
})

const CurateLogEntryFileSchema = z.discriminatedUnion('status', [
  CurateLogEntryBaseSchema.extend({status: z.literal('processing')}),
  CurateLogEntryBaseSchema.extend({
    completedAt: z.number(),
    response: z.string().optional(),
    status: z.literal('completed'),
  }),
  CurateLogEntryBaseSchema.extend({
    completedAt: z.number(),
    error: z.string(),
    status: z.literal('error'),
  }),
  CurateLogEntryBaseSchema.extend({
    completedAt: z.number(),
    status: z.literal('cancelled'),
  }),
])

// ── FileCurateLogStore ────────────────────────────────────────────────────────

const ID_PATTERN = new RegExp(`^${CURATE_LOG_ID_PREFIX}-\\d+$`)
const DEFAULT_MAX_ENTRIES = 100
/** Entries stuck in "processing" longer than this are considered interrupted (daemon was killed). */
const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

type FileCurateLogStoreOptions = {
  baseDir: string
  maxEntries?: number
}

/**
 * File-based implementation of ICurateLogStore.
 *
 * Each log entry is stored as a JSON file:
 *   {baseDir}/curate-log/cur-{timestamp_ms}.json
 *
 * Writes are atomic (tmp → rename). Reads validate with Zod and return null
 * for corrupt/missing files. Prunes oldest entries when maxEntries is exceeded.
 */
export class FileCurateLogStore implements ICurateLogStore {
  private lastTimestamp = 0
  private readonly logDir: string
  private readonly maxEntries: number

  constructor(opts: FileCurateLogStoreOptions) {
    this.logDir = join(opts.baseDir, CURATE_LOG_DIR)
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * Retrieve an entry by ID. Returns null if:
   * - ID format is invalid (security: prevents path traversal)
   * - File does not exist
   * - File content fails Zod validation (corrupted)
   */
  async getById(id: string): Promise<CurateLogEntry | null> {
    if (!ID_PATTERN.test(id)) return null

    try {
      const raw = await readFile(this.entryPath(id), 'utf8')
      const parsed = CurateLogEntryFileSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      return await this.resolveStale(parsed.data as CurateLogEntry)
    } catch {
      return null
    }
  }

  /**
   * Generate the next monotonic log entry ID in the format `cur-{timestamp_ms}`.
   * Guaranteed to increase even if called multiple times in the same millisecond.
   */
  async getNextId(): Promise<string> {
    const now = Date.now()
    this.lastTimestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now
    return `${CURATE_LOG_ID_PREFIX}-${this.lastTimestamp}`
  }

  /**
   * List entries sorted newest-first (by timestamp embedded in filename).
   * Applies limit after sorting. Skips corrupt entries silently.
   */
  async list({limit}: {limit?: number} = {}): Promise<CurateLogEntry[]> {
    let files: string[]
    try {
      const entries = await readdir(this.logDir, {withFileTypes: true})
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json') && ID_PATTERN.test(e.name.slice(0, -5)))
        .map((e) => e.name)
        .sort()
        .reverse() // newest-first (lexicographic descending = timestamp descending)
    } catch {
      return []
    }

    const toRead = limit === undefined ? files : files.slice(0, limit)
    const results: CurateLogEntry[] = []

    await Promise.all(
      toRead.map(async (filename) => {
        const id = filename.slice(0, -5) // strip .json
        const entry = await this.getById(id)
        if (entry) results.push(entry)
      }),
    )

    // Re-sort results (Promise.all may reorder due to concurrent reads)
    return results.sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * Persist a log entry atomically (write to tmp, then rename).
   * After saving, prunes oldest entries if count exceeds maxEntries (best-effort).
   */
  async save(entry: CurateLogEntry): Promise<void> {
    await mkdir(this.logDir, {recursive: true})
    const filePath = this.entryPath(entry.id)
    const tmpPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf8')
    await rename(tmpPath, filePath)

    // Prune oldest entries (best-effort — ignore errors)
    this.pruneOldest().catch(() => {})
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private entryPath(id: string): string {
    return join(this.logDir, `${id}.json`)
  }

  private async pruneOldest(): Promise<void> {
    const entries = await readdir(this.logDir, {withFileTypes: true})
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json') && ID_PATTERN.test(e.name.slice(0, -5)))
      .map((e) => e.name)
      .sort() // oldest-first

    if (files.length <= this.maxEntries) return

    const toDelete = files.slice(0, files.length - this.maxEntries)
    await Promise.all(toDelete.map((f) => rm(join(this.logDir, f), {force: true}).catch(() => {})))
  }

  /**
   * If a "processing" entry is older than STALE_PROCESSING_THRESHOLD_MS, the daemon
   * was killed before it could finalize it. Rewrite it as "error" on disk (best-effort)
   * and return the corrected entry so the display shows "interrupted" instead of processing.
   */
  private async resolveStale(entry: CurateLogEntry): Promise<CurateLogEntry> {
    if (entry.status !== 'processing') return entry
    if (Date.now() - entry.startedAt <= STALE_PROCESSING_THRESHOLD_MS) return entry

    const recovered: CurateLogEntry = {
      ...entry,
      completedAt: entry.startedAt + STALE_PROCESSING_THRESHOLD_MS,
      error: 'Interrupted (daemon terminated)',
      status: 'error',
    }

    this.save(recovered).catch(() => {})
    return recovered
  }
}
