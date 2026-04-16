import {randomUUID} from 'node:crypto'
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {DREAM_LOG_DIR, DREAM_LOG_ID_PREFIX} from '../../constants.js'
import {type DreamLogEntry, DreamLogEntrySchema, type DreamLogStatus} from './dream-log-schema.js'
const ID_PATTERN = new RegExp(`^${DREAM_LOG_ID_PREFIX}-\\d+$`)
const DEFAULT_MAX_ENTRIES = 50
/** Entries stuck in "processing" longer than this are considered interrupted. */
const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

type DreamLogStoreOptions = {
  baseDir: string
  maxEntries?: number
}

/**
 * File-based store for dream log entries.
 *
 * Each entry is stored as a JSON file:
 *   {baseDir}/dream-log/drm-{timestamp_ms}.json
 *
 * Writes are atomic (tmp → rename). Reads validate with Zod and return null
 * for corrupt/missing files. Prunes oldest entries when maxEntries is exceeded.
 */
export class DreamLogStore {
  private lastTimestamp = 0
  private readonly logDir: string
  private readonly maxEntries: number

  constructor(opts: DreamLogStoreOptions) {
    this.logDir = join(opts.baseDir, DREAM_LOG_DIR)
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * Retrieve an entry by ID. Returns null if:
   * - ID format is invalid (security: prevents path traversal)
   * - File does not exist
   * - File content fails Zod validation (corrupted)
   */
  async getById(id: string): Promise<DreamLogEntry | null> {
    if (!ID_PATTERN.test(id)) return null

    try {
      const raw = await readFile(this.entryPath(id), 'utf8')
      const parsed = DreamLogEntrySchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      return await this.resolveStale(parsed.data)
    } catch {
      return null
    }
  }

  /**
   * Generate the next monotonic log entry ID in the format `drm-{timestamp_ms}`.
   * Guaranteed to increase even if called multiple times in the same millisecond.
   */
  async getNextId(): Promise<string> {
    const now = Date.now()
    this.lastTimestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now
    return `${DREAM_LOG_ID_PREFIX}-${this.lastTimestamp}`
  }

  /**
   * List entries sorted newest-first (by timestamp embedded in filename).
   * Filters (status, after, before) are applied before limit. Skips corrupt entries silently.
   */
  async list({
    after,
    before,
    limit,
    status,
  }: {after?: number; before?: number; limit?: number; status?: DreamLogStatus[]} = {}): Promise<DreamLogEntry[]> {
    let files: string[]
    try {
      const entries = await readdir(this.logDir, {withFileTypes: true})
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json') && ID_PATTERN.test(e.name.slice(0, -5)))
        .map((e) => e.name)
        .sort()
        .reverse()
    } catch {
      return []
    }

    const hasFilters = Boolean(status?.length || after !== undefined || before !== undefined)
    const filesToRead = hasFilters ? files : files.slice(0, limit ?? files.length)

    const allEntries: DreamLogEntry[] = []
    await Promise.all(
      filesToRead.map(async (filename) => {
        const id = filename.slice(0, -5)
        const entry = await this.getById(id)
        if (entry) allEntries.push(entry)
      }),
    )

    allEntries.sort((a, b) => b.startedAt - a.startedAt)

    let results = allEntries
    if (status?.length) {
      results = results.filter((e) => status.includes(e.status))
    }

    if (after !== undefined) {
      results = results.filter((e) => e.startedAt >= after)
    }

    if (before !== undefined) {
      results = results.filter((e) => e.startedAt <= before)
    }

    return limit === undefined ? results : results.slice(0, limit)
  }

  /**
   * Persist a log entry atomically (write to tmp, then rename).
   * After saving, prunes oldest entries if count exceeds maxEntries (best-effort).
   */
  async save(entry: DreamLogEntry): Promise<void> {
    DreamLogEntrySchema.parse(entry)
    await mkdir(this.logDir, {recursive: true})
    const filePath = this.entryPath(entry.id)
    const tmpPath = `${filePath}.${randomUUID()}.tmp`

    await writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf8')
    await rename(tmpPath, filePath)

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
      .sort()

    if (files.length <= this.maxEntries) return

    const toDelete = files.slice(0, files.length - this.maxEntries)
    await Promise.all(toDelete.map((f) => rm(join(this.logDir, f), {force: true}).catch(() => {})))
  }

  /**
   * If a "processing" entry is older than STALE_PROCESSING_THRESHOLD_MS, the daemon
   * was killed before it could finalize it. Rewrite as "error" on disk (best-effort).
   */
  private async resolveStale(entry: DreamLogEntry): Promise<DreamLogEntry> {
    if (entry.status !== 'processing') return entry
    if (Date.now() - entry.startedAt <= STALE_PROCESSING_THRESHOLD_MS) return entry

    const recovered: DreamLogEntry = {
      ...entry,
      completedAt: Date.now(),
      error: 'Interrupted (daemon terminated)',
      status: 'error',
    }

    this.save(recovered).catch(() => {})
    return recovered
  }
}
