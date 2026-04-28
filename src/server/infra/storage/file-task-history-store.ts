/**
 * File-based implementation of `ITaskHistoryStore`.
 *
 * Two-tier on-disk format:
 * - `_index.jsonl` — append-only summary file. One JSON-line per save.
 *   Cheap to scan for list views.
 * - `data/tsk-${taskId}.json` — full Level 2 detail per task (response,
 *   tool calls, reasoning) for the detail panel.
 *
 * Save ordering (data first, index second) bounds the failure mode to
 * orphan data files (invisible to `list()`); compaction in M2.03 will
 * sweep them. The reverse order would create dangling index entries
 * pointing at non-existent data files.
 *
 * M2.02 scope: save / getById / list. Prune (M2.03), stale recovery
 * (M2.04), and delete/clear (M2.05) land in subsequent tickets.
 */

import {randomUUID} from 'node:crypto'
import {appendFile, copyFile, mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {TaskListItem} from '../../../shared/transport/events/task-events.js'
import type {TaskHistoryEntry} from '../../core/domain/entities/task-history-entry.js'
import type {ITaskHistoryStore, TaskHistoryStatus} from '../../core/interfaces/storage/i-task-history-store.js'

import {
  TASK_HISTORY_DEFAULT_MAX_AGE_DAYS,
  TASK_HISTORY_DEFAULT_MAX_ENTRIES,
  TASK_HISTORY_DEFAULT_MAX_INDEX_BLOAT_RATIO,
  TASK_HISTORY_DIR,
  TASK_HISTORY_STALE_THRESHOLD_MS,
} from '../../constants.js'
import {TASK_HISTORY_SCHEMA_VERSION, TaskHistoryEntrySchema} from '../../core/domain/entities/task-history-entry.js'
import {TaskErrorDataSchema} from '../../core/domain/transport/schemas.js'
import {transportLog} from '../../utils/process-logger.js'

const STATUS_VALUES = ['cancelled', 'completed', 'created', 'error', 'started'] as const
const StatusSchema = z.enum(STATUS_VALUES)

/** `clear()` default — terminal statuses only; active tasks (created/started) are preserved. */
const DEFAULT_TERMINAL_STATUSES: readonly TaskHistoryStatus[] = ['cancelled', 'completed', 'error']

/**
 * Index summary line — one per save. Drops heavy fields (responseContent,
 * toolCalls, reasoningContents, sessionId, result) that the list view
 * never renders. Detail panel fetches those via `getById`.
 */
const IndexDataLineSchema = z.object({
  completedAt: z.number().optional(),
  content: z.string(),
  createdAt: z.number(),
  error: TaskErrorDataSchema.optional(),
  files: z.array(z.string()).optional(),
  folderPath: z.string().optional(),
  /**
   * Wall-clock time the line was appended to `_index.jsonl`. Optional for
   * back-compat with legacy lines (treated as `undefined` → eligible for
   * stale recovery if otherwise stale by age). Used by the daemon-startup
   * gate to skip recovery for entries written by the CURRENT daemon
   * (post-boot), which by definition belong to in-memory active tasks.
   */
  lastSavedAt: z.number().optional(),
  model: z.string().optional(),
  projectPath: z.string(),
  provider: z.string().optional(),
  schemaVersion: z.literal(TASK_HISTORY_SCHEMA_VERSION),
  startedAt: z.number().optional(),
  status: StatusSchema,
  taskId: z.string(),
  type: z.string(),
})
type IndexDataLine = z.infer<typeof IndexDataLineSchema>

/**
 * Tombstone written by delete/deleteMany/clear. List skips taskIds whose final line is a tombstone.
 * `deletedAt` and `schemaVersion` are optional for back-compat with bare `{_deleted, taskId}` lines
 * that may exist in older indexes or be appended by tests.
 */
const IndexTombstoneSchema = z.object({
  _deleted: z.literal(true),
  deletedAt: z.number().optional(),
  schemaVersion: z.literal(TASK_HISTORY_SCHEMA_VERSION).optional(),
  taskId: z.string(),
})
type IndexTombstone = z.infer<typeof IndexTombstoneSchema>

const IndexLineSchema = z.union([IndexTombstoneSchema, IndexDataLineSchema])
type IndexLine = IndexDataLine | IndexTombstone

/** Path-traversal guard. taskIds are typically UUIDs; restrict to alphanumeric + underscore + hyphen. */
const TASK_ID_PATTERN = /^[\w-]+$/
const INDEX_FILE = '_index.jsonl'
const DATA_DIR = 'data'
const FILENAME_PREFIX = 'tsk-'

type FileTaskHistoryStoreOptions = {
  baseDir: string
  /**
   * Wall-clock time at which this daemon process started. Used to gate
   * stale-recovery: only entries whose `lastSavedAt < daemonStartedAt`
   * are considered orphans of a previous daemon boot. Entries saved
   * post-boot belong to an in-memory active task and must NEVER be
   * recovered to `error: INTERRUPTED` (the read path would otherwise
   * ping-pong with the live throttled saves at every `list()` call).
   *
   * Defaults to `Date.now()` at construction time, which is correct for
   * production (one store per project, constructed at first use).
   * Tests that wish to simulate "entries from a previous daemon" should
   * pass a value FAR IN THE FUTURE so their saves register as pre-boot.
   */
  daemonStartedAt?: number
  /**
   * Age-based prune threshold. Entries older than this many days are
   * tombstoned + their data files unlinked. Default `TASK_HISTORY_DEFAULT_MAX_AGE_DAYS` (30).
   * Set to 0 to disable age-based prune.
   */
  maxAgeDays?: number
  /**
   * Count-based prune cap. When live entry count exceeds this, oldest excess
   * entries are tombstoned. Default `TASK_HISTORY_DEFAULT_MAX_ENTRIES` (1000).
   * Pass `Number.POSITIVE_INFINITY` to disable.
   */
  maxEntries?: number
  /**
   * Index-compaction trigger. When `total_lines / live_count` exceeds this
   * ratio, `_index.jsonl` is rewritten with one line per live entry. Default
   * `TASK_HISTORY_DEFAULT_MAX_INDEX_BLOAT_RATIO` (2). Pass
   * `Number.POSITIVE_INFINITY` to disable compaction.
   */
  maxIndexBloatRatio?: number
  /**
   * Staleness threshold for read-path recovery: entries with status `'created'`
   * or `'started'` whose `createdAt` is older than this are rewritten to
   * `status: 'error'` with `code: 'INTERRUPTED'`. Defaults to
   * `TASK_HISTORY_STALE_THRESHOLD_MS` (10 minutes). Pass
   * `Number.POSITIVE_INFINITY` to disable recovery.
   */
  staleThresholdMs?: number
}

export class FileTaskHistoryStore implements ITaskHistoryStore {
  private readonly daemonStartedAt: number
  private readonly dataDir: string
  /** Dedup-by-taskId result of the last index read. Invalidated on save/delete/recovery/prune. */
  private indexCache: Map<string, IndexLine> | undefined
  /**
   * In-flight `readIndexDedup` promise — concurrent callers (e.g. `getById`
   * and a parallel `prune` timer) share the same pass so the embedded
   * stale-recovery side effect cannot double-append index lines for the
   * same taskId.
   */
  private indexDedupInFlight: Promise<Map<string, IndexLine>> | undefined
  private readonly indexPath: string
  private readonly maxAgeDays: number
  private readonly maxEntries: number
  private readonly maxIndexBloatRatio: number
  /**
   * Promise-chain lock serializing operations that mutate the index file
   * AND the data dir together — compaction (snapshot → rewrite → post-rewrite
   * recovery → orphan sweep) and tombstoneAndUnlink (append + unlink). These
   * two operations cannot interleave: a tombstone landing mid-rewrite would
   * be wiped by `rename`, and `recoverPreRenameSaves` cannot recover the
   * tombstone (the data file has been unlinked) — leaving a phantom row
   * (B2). `save()` is intentionally NOT locked: its data file persists, so
   * the C1 fix recovers from the data dir if the index line is wiped.
   */
  private operationLock: Promise<void> = Promise.resolve()
  /** Dedupes concurrent prune passes — only one runs at a time. */
  private pruneInFlight = false
  /** Set when a save fires while a prune is in flight; triggers a re-run after current pass. */
  private pruneRequested = false
  private readonly staleThresholdMs: number
  private readonly storeDir: string

  constructor(opts: FileTaskHistoryStoreOptions) {
    this.storeDir = join(opts.baseDir, TASK_HISTORY_DIR)
    this.indexPath = join(this.storeDir, INDEX_FILE)
    this.dataDir = join(this.storeDir, DATA_DIR)
    this.daemonStartedAt = opts.daemonStartedAt ?? Date.now()
    this.maxAgeDays = opts.maxAgeDays ?? TASK_HISTORY_DEFAULT_MAX_AGE_DAYS
    this.maxEntries = opts.maxEntries ?? TASK_HISTORY_DEFAULT_MAX_ENTRIES
    this.maxIndexBloatRatio = opts.maxIndexBloatRatio ?? TASK_HISTORY_DEFAULT_MAX_INDEX_BLOAT_RATIO
    this.staleThresholdMs = opts.staleThresholdMs ?? TASK_HISTORY_STALE_THRESHOLD_MS
  }

  // ── Delete + clear (M2.05) ─────────────────────────────────────────────────

  async clear(
    options: {projectPath?: string; statuses?: TaskHistoryStatus[]} = {},
  ): Promise<{deletedCount: number; taskIds: string[]}> {
    const {projectPath, statuses = DEFAULT_TERMINAL_STATUSES} = options

    const dedup = await this.readIndexDedup()
    const targets: string[] = []
    for (const line of dedup.values()) {
      if ('_deleted' in line) continue
      if (projectPath !== undefined && line.projectPath !== projectPath) continue
      if (!statuses.includes(line.status)) continue
      targets.push(line.taskId)
    }

    if (targets.length > 0) await this.tombstoneAndUnlink(targets)
    return {deletedCount: targets.length, taskIds: targets}
  }

  async delete(taskId: string): Promise<boolean> {
    if (!TASK_ID_PATTERN.test(taskId)) return false

    const dedup = await this.readIndexDedup()
    const line = dedup.get(taskId)
    const wasLive = line !== undefined && !('_deleted' in line)
    if (!wasLive) return false

    await this.tombstoneAndUnlink([taskId])
    return true
  }

  async deleteMany(taskIds: string[]): Promise<string[]> {
    const valid = taskIds.filter((id) => TASK_ID_PATTERN.test(id))
    if (valid.length === 0) return []

    const dedup = await this.readIndexDedup()
    const live = valid.filter((id) => {
      const line = dedup.get(id)
      return line !== undefined && !('_deleted' in line)
    })

    if (live.length > 0) await this.tombstoneAndUnlink(live)
    return live
  }

  // ── M2.02 scope ────────────────────────────────────────────────────────────

  async getById(taskId: string): Promise<TaskHistoryEntry | undefined> {
    if (!TASK_ID_PATTERN.test(taskId)) return undefined

    // readIndexDedup is the canonical recovery driver — it honors the
    // daemon-startup gate (C0) and rewrites the data file for any genuinely
    // orphaned entries from a previous daemon boot. After it runs, reading
    // the data file gives the recovered (or live, post-boot) shape.
    const dedup = await this.readIndexDedup()
    const line = dedup.get(taskId)
    if (line === undefined || '_deleted' in line) return undefined

    try {
      const raw = await readFile(this.dataPath(taskId), 'utf8')
      const parsed = TaskHistoryEntrySchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  async list(
    options: {
      after?: number
      before?: number
      limit?: number
      projectPath?: string
      status?: TaskHistoryStatus[]
      type?: string[]
    } = {},
  ): Promise<TaskListItem[]> {
    const dedup = await this.readIndexDedup()

    const matches: IndexDataLine[] = []
    for (const line of dedup.values()) {
      if ('_deleted' in line) continue
      if (options.projectPath !== undefined && line.projectPath !== options.projectPath) continue
      if (options.status?.length && !options.status.includes(line.status)) continue
      if (options.type?.length && !options.type.includes(line.type)) continue
      if (options.after !== undefined && line.createdAt < options.after) continue
      if (options.before !== undefined && line.createdAt > options.before) continue
      matches.push(line)
    }

    matches.sort((a, b) => b.createdAt - a.createdAt)
    const sliced = options.limit === undefined ? matches : matches.slice(0, options.limit)
    return sliced.map((line) => toTaskListItem(line))
  }

  async save(entry: TaskHistoryEntry): Promise<void> {
    // Validate at the write boundary so corrupt data files never get written.
    const validated = TaskHistoryEntrySchema.parse(entry)

    if (!TASK_ID_PATTERN.test(validated.taskId)) {
      throw new Error(`Invalid taskId for storage: ${validated.taskId}`)
    }

    await mkdir(this.dataDir, {recursive: true})

    // Step 1: write the data file atomically (UUID temp → rename).
    await this.writeAtomic(this.dataPath(validated.taskId), JSON.stringify(validated, null, 2))

    // Step 2: append the summary line (single ≤4KB POSIX append, atomic per
    // PIPE_BUF). `lastSavedAt` is the wall-clock time of THIS append — the
    // daemon-startup gate in `isStaleAndRecoverable` uses it to skip recovery
    // for entries the current daemon is actively writing (live in-memory
    // tasks). The C1 race vs. compaction is closed by `maybeCompact`'s
    // post-rewrite re-read of the index.
    const summary: IndexDataLine = {...projectToIndexLine(validated), lastSavedAt: Date.now()}
    await appendFile(this.indexPath, JSON.stringify(summary) + '\n', 'utf8')

    this.indexCache = undefined

    // Step 3: schedule prune+compaction in background (fire-and-forget, dedup'd).
    this.firePrune()
  }

  /**
   * Construct the recovered (status='error') variant of a stale entry.
   * Uses Zod parse to narrow to the discriminated 'error' branch without an `as` cast.
   */
  private buildRecovered(entry: TaskHistoryEntry, now: number): TaskHistoryEntry {
    return TaskHistoryEntrySchema.parse({
      ...entry,
      completedAt: now,
      error: {
        code: 'INTERRUPTED',
        message: 'Interrupted (daemon terminated)',
        name: 'TaskError',
      },
      status: 'error',
    })
  }

  private dataPath(taskId: string): string {
    return join(this.dataDir, `${FILENAME_PREFIX}${taskId}.json`)
  }

  private async doReadIndexDedup(): Promise<Map<string, IndexLine>> {
    const map = new Map<string, IndexLine>()

    let raw: string
    try {
      raw = await readFile(this.indexPath, 'utf8')
    } catch {
      // No index yet — return empty map and cache it.
      this.indexCache = map
      return map
    }

    for (const lineRaw of raw.split('\n')) {
      const trimmed = lineRaw.trim()
      if (!trimmed) continue

      let json: unknown
      try {
        json = JSON.parse(trimmed)
      } catch {
        continue
      }

      const parsed = IndexLineSchema.safeParse(json)
      if (!parsed.success) continue

      // Last line wins per taskId (dedup).
      map.set(parsed.data.taskId, parsed.data)
    }

    // Stale recovery — sequential within this pass to keep index appends atomic.
    // The daemon-startup gate (C0) inside `isStaleAndRecoverable` skips entries
    // saved post-boot so live in-memory tasks (>10 min old createdAt but actively
    // writing throttled updates) are not falsely tombstoned to INTERRUPTED.
    const now = Date.now()
    const staleTaskIds: string[] = []
    for (const [taskId, line] of map) {
      if ('_deleted' in line) continue
      if (this.isStaleAndRecoverable(line, now)) staleTaskIds.push(taskId)
    }

    for (const taskId of staleTaskIds) {
      // eslint-disable-next-line no-await-in-loop -- sequential is intentional (atomicity)
      const recovered = await this.recoverViaTaskId(taskId, now)
      if (recovered !== undefined) map.set(taskId, recovered)
    }

    this.indexCache = map
    return map
  }

  /**
   * Schedule an asynchronous prune+compaction pass without blocking the caller.
   * Deduplicates concurrent calls — only one pass runs at a time. If a save
   * fires while a pass is in-flight, `pruneRequested` is set so a follow-up
   * pass runs once the current one finishes (catches saves that landed mid-pass).
   *
   * Uses `setTimeout(fn, 0)` to defer the pass to the next macrotask, ensuring
   * all pending microtasks (e.g. a follow-up `getById` that triggers M2.04
   * recovery on the same task) drain before prune runs. Without this, the
   * prune's own `readIndexDedup` could trigger a parallel recovery race.
   */
  private firePrune(): void {
    if (this.pruneInFlight) {
      this.pruneRequested = true
      return
    }

    this.pruneInFlight = true
    this.pruneRequested = false
    const timer = setTimeout(() => {
      this.pruneAndCompact()
        .catch((error: unknown) => {
          transportLog(
            `task-history: prune+compaction failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        .finally(() => {
          this.pruneInFlight = false
          if (this.pruneRequested) {
            this.pruneRequested = false
            this.firePrune()
          }
        })
    }, 0)
    // Don't keep the event loop alive for a pending prune at process exit.
    timer.unref?.()
  }

  private isStale(status: TaskHistoryStatus, createdAt: number, now: number): boolean {
    return (status === 'created' || status === 'started') && now - createdAt > this.staleThresholdMs
  }

  /**
   * Daemon-startup gate (C0): only entries whose `lastSavedAt` predates this
   * daemon's boot are eligible for stale recovery. An entry written by the
   * CURRENT daemon (post-boot) belongs to an in-memory active task whose
   * lifecycle hook is still firing throttled saves — recovering it would
   * ping-pong the on-disk state against the next save.
   *
   * Legacy lines (no `lastSavedAt`) fall back to the age-only check so
   * existing index files from before this field was introduced behave as
   * they did pre-C0.
   */
  private isStaleAndRecoverable(line: IndexDataLine, now: number): boolean {
    if (!this.isStale(line.status, line.createdAt, now)) return false
    if (line.lastSavedAt !== undefined && line.lastSavedAt >= this.daemonStartedAt) return false
    return true
  }

  /**
   * Rewrite `_index.jsonl` keeping one line per live entry when bloat exceeds
   * the configured ratio. Sweeps orphan data files (taskId not in live map)
   * after the rewrite so the data dir stays in sync.
   *
   * Locked against `tombstoneAndUnlink` via `operationLock` — see B2 comment
   * on the field declaration.
   */
  private async maybeCompact(): Promise<void> {
    if (!Number.isFinite(this.maxIndexBloatRatio)) return

    await this.withOperationLock(async () => {
      let raw: string
      try {
        raw = await readFile(this.indexPath, 'utf8')
      } catch {
        return
      }

      const allLines: IndexLine[] = []
      const liveMap = new Map<string, IndexDataLine>()
      for (const lineRaw of raw.split('\n')) {
        const trimmed = lineRaw.trim()
        if (!trimmed) continue
        let json: unknown
        try {
          json = JSON.parse(trimmed)
        } catch {
          continue
        }

        const parsed = IndexLineSchema.safeParse(json)
        if (!parsed.success) continue
        allLines.push(parsed.data)
        if ('_deleted' in parsed.data) {
          liveMap.delete(parsed.data.taskId)
        } else {
          liveMap.set(parsed.data.taskId, parsed.data)
        }
      }

      const liveCount = liveMap.size
      const totalCount = allLines.length

      // Avoid divide-by-zero; skip when nothing to compact.
      if (liveCount === 0 || totalCount / liveCount <= this.maxIndexBloatRatio) return

      const liveLines = [...liveMap.values()]
      await this.rewriteIndex(liveLines)

      // C1 fix — close BOTH race windows around the rename:
      // (1) saves whose appendFile landed AFTER the rename are visible in the
      //     post-rewrite index → picked up by the re-read.
      // (2) saves whose appendFile landed BEFORE the rename were overwritten
      //     by the rename, but their data file (`tsk-{taskId}.json`) still
      //     exists on disk. We detect them as "data-file present, taskId not
      //     in post-rewrite index AND not tombstoned", read the data file,
      //     and re-append the index line. The data file is preserved by the
      //     subsequent sweep because the recovered taskId is in the live set.
      const postRewriteLiveIds = new Set<string>(liveMap.keys())
      const postRewriteTombstones = new Set<string>()
      try {
        const postRaw = await readFile(this.indexPath, 'utf8')
        for (const lineRaw of postRaw.split('\n')) {
          const trimmed = lineRaw.trim()
          if (!trimmed) continue
          let json: unknown
          try {
            json = JSON.parse(trimmed)
          } catch {
            continue
          }

          const parsed = IndexLineSchema.safeParse(json)
          if (!parsed.success) continue
          if ('_deleted' in parsed.data) {
            postRewriteLiveIds.delete(parsed.data.taskId)
            postRewriteTombstones.add(parsed.data.taskId)
          } else {
            postRewriteLiveIds.add(parsed.data.taskId)
          }
        }
      } catch {
        // Fall back to the snapshot if the post-rewrite read fails.
      }

      await this.recoverPreRenameSaves(postRewriteLiveIds, postRewriteTombstones)

      await this.sweepOrphanData(postRewriteLiveIds)
      this.indexCache = undefined
    })
  }

  /**
   * Best-effort: write the recovered shape to the data file FIRST, then
   * append the recovery line to the index. Sequential ordering matches
   * `save()` and bounds the failure mode: if the data-file write fails,
   * we return BEFORE the index append so the index never gains an orphan
   * recovery line pointing to an unmutated data file (which would split
   * `list()` from `getById()` — N1). Each step swallows its own error
   * and logs via `transportLog`; never throws to caller.
   */
  private async persistRecovery(recovered: TaskHistoryEntry): Promise<void> {
    try {
      await this.writeAtomic(this.dataPath(recovered.taskId), JSON.stringify(recovered, null, 2))
    } catch (error: unknown) {
      transportLog(
        `stale recovery: failed to write data file for ${recovered.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    const recoveryLine: IndexDataLine = {...projectToIndexLine(recovered), lastSavedAt: Date.now()}
    try {
      await appendFile(this.indexPath, JSON.stringify(recoveryLine) + '\n', 'utf8')
    } catch (error: unknown) {
      transportLog(
        `stale recovery: failed to append index line for ${recovered.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      // Index stays stale; next read will re-attempt via recoverViaTaskId,
      // whose terminal-status short-circuit returns the data file's now-
      // recovered projection without re-writing.
    }

    this.indexCache = undefined
  }

  /**
   * Phase 1 (age) + Phase 2 (count) prune. Builds the dead-taskId set from
   * the dedup'd live map and delegates to `tombstoneAndUnlink`.
   */
  private async prune(): Promise<void> {
    const dedup = await this.readIndexDedup()
    const liveEntries: IndexDataLine[] = []
    for (const line of dedup.values()) {
      if ('_deleted' in line) continue
      liveEntries.push(line)
    }

    const dead: string[] = []

    // Phase 1: age prune.
    if (this.maxAgeDays > 0) {
      const cutoff = Date.now() - this.maxAgeDays * 86_400_000
      for (const line of liveEntries) {
        if (line.createdAt < cutoff) dead.push(line.taskId)
      }
    }

    // Phase 2: count prune. Survivors = entries NOT already marked dead by phase 1.
    const survivors = liveEntries.filter((line) => !dead.includes(line.taskId))
    if (Number.isFinite(this.maxEntries) && survivors.length > this.maxEntries) {
      // Oldest excess: sort asc by createdAt and take the head.
      const sorted = [...survivors].sort((a, b) => a.createdAt - b.createdAt)
      const excessCount = survivors.length - this.maxEntries
      for (let i = 0; i < excessCount; i++) dead.push(sorted[i].taskId)
    }

    if (dead.length > 0) await this.tombstoneAndUnlink(dead)
  }

  private async pruneAndCompact(): Promise<void> {
    await this.prune()
    await this.maybeCompact()
    // Always invalidate the cache after a pass so subsequent reads re-read
    // disk — protects against external writes (e.g. tests appending tombstones
    // out-of-band) that happen between prune phases.
    this.indexCache = undefined
  }

  private async readIndexDedup(): Promise<Map<string, IndexLine>> {
    if (this.indexCache) return this.indexCache
    // Re-entrancy: if a pass is already in flight (e.g. one started by getById
    // and a parallel one about to start from the firePrune timer), reuse it.
    // Without this, both passes find the same stale entry and both call
    // `persistRecovery` → two recovery lines appended for the same taskId.
    if (this.indexDedupInFlight) return this.indexDedupInFlight

    this.indexDedupInFlight = this.doReadIndexDedup()
    try {
      return await this.indexDedupInFlight
    } finally {
      this.indexDedupInFlight = undefined
    }
  }

  /**
   * Detect data files whose index line was overwritten by the compaction
   * rename (race window: save's `appendFile` landed BEFORE compaction's
   * `rename`). For each, parse the data file and either:
   *   - C1 path (current-boot save): re-append as live with `lastSavedAt = now`.
   *   - N2 path (prior-boot orphan): delegate to `recoverViaTaskId`, which
   *     mutates the data file to `status: 'error'` and persists the recovery
   *     line. Without this gate, an old `'started'` orphan would be re-stamped
   *     `lastSavedAt = Date.now()` and the C0 daemon-startup check would then
   *     forever protect it as a live current-boot task.
   *
   * Distinguishing C1 vs N2: synthesize a probe `IndexDataLine` from the data
   * file with no `lastSavedAt` and feed it through `isStaleAndRecoverable`.
   * Recent saves (createdAt within `staleThresholdMs`) fall through to the
   * C1 branch; old `'created'`/`'started'` orphans take the N2 branch.
   */
  private async recoverPreRenameSaves(
    liveIds: Set<string>,
    tombstones: Set<string>,
  ): Promise<void> {
    let dataFilenames: string[]
    try {
      dataFilenames = await readdir(this.dataDir)
    } catch {
      return
    }

    const now = Date.now()
    for (const filename of dataFilenames) {
      if (!filename.startsWith(FILENAME_PREFIX) || !filename.endsWith('.json')) continue
      const taskId = filename.slice(FILENAME_PREFIX.length, -'.json'.length)
      if (liveIds.has(taskId) || tombstones.has(taskId)) continue

      // Orphan candidate — read the data file and try to recover.
      let raw: string
      try {
        // eslint-disable-next-line no-await-in-loop
        raw = await readFile(this.dataPath(taskId), 'utf8')
      } catch {
        continue
      }

      let parsed
      try {
        parsed = TaskHistoryEntrySchema.safeParse(JSON.parse(raw))
      } catch {
        continue
      }

      if (!parsed.success) continue

      const projected = projectToIndexLine(parsed.data)

      // N2: prior-boot stale orphan → recover to 'error' before re-appending.
      if (this.isStaleAndRecoverable(projected, now)) {
        // eslint-disable-next-line no-await-in-loop
        const recoveredLine = await this.recoverViaTaskId(taskId, now)
        if (recoveredLine !== undefined) liveIds.add(taskId)
        continue
      }

      // C1: current-boot orphan from the rewrite race → re-append as live.
      const recovered: IndexDataLine = {...projected, lastSavedAt: now}
      try {
        // eslint-disable-next-line no-await-in-loop
        await appendFile(this.indexPath, JSON.stringify(recovered) + '\n', 'utf8')
        liveIds.add(taskId)
      } catch (error) {
        transportLog(
          `task-history: pre-rename save recovery append failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  /**
   * Read the data file for a stale candidate, mutate to error, persist.
   * Returns the summary projection of the recovered entry. Returns undefined
   * if the data file is missing/corrupt. If the data file already shows a
   * terminal status (a prior partial-success recovery), returns its projection
   * without re-recovering — defensive idempotency restoration.
   */
  private async recoverViaTaskId(taskId: string, now: number): Promise<IndexDataLine | undefined> {
    let entry: TaskHistoryEntry
    try {
      const raw = await readFile(this.dataPath(taskId), 'utf8')
      const parsed = TaskHistoryEntrySchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return undefined
      entry = parsed.data
    } catch {
      return undefined
    }

    if (entry.status !== 'created' && entry.status !== 'started') {
      return projectToIndexLine(entry)
    }

    const recovered = this.buildRecovered(entry, now)
    await this.persistRecovery(recovered)
    return projectToIndexLine(recovered)
  }

  /**
   * Atomically replace `_index.jsonl` with a fresh file containing exactly
   * one line per live entry. Preserves the previous main as `_index.jsonl.bak`
   * for one cycle. Sequence (best-effort .bak; atomic main swap):
   *   1. Write `_index.jsonl.tmp` with the new content
   *   2. copyFile `_index.jsonl` → `_index.jsonl.bak` (best-effort)
   *   3. rename `_index.jsonl.tmp` → `_index.jsonl` (single atomic syscall)
   */
  private async rewriteIndex(liveLines: readonly IndexDataLine[]): Promise<void> {
    const tmpPath = `${this.indexPath}.tmp`
    const bakPath = `${this.indexPath}.bak`
    const newContent = liveLines.map((line) => JSON.stringify(line)).join('\n') + (liveLines.length > 0 ? '\n' : '')

    try {
      await writeFile(tmpPath, newContent, 'utf8')
    } catch (error) {
      transportLog(
        `task-history: rewriteIndex tmp write failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    // Best-effort .bak copy — non-fatal if it fails.
    await copyFile(this.indexPath, bakPath).catch((error: unknown) => {
      transportLog(
        `task-history: rewriteIndex .bak copy failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    try {
      await rename(tmpPath, this.indexPath)
    } catch (error) {
      transportLog(
        `task-history: rewriteIndex rename failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      // Clean up stranded .tmp.
      await rm(tmpPath, {force: true}).catch(() => {})
    }
  }

  /**
   * After compaction, unlink any `data/tsk-${taskId}.json` whose taskId is
   * not in the live map. Best-effort per file — ENOENT etc. is swallowed.
   */
  private async sweepOrphanData(liveTaskIds: ReadonlySet<string>): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.dataDir)
    } catch {
      return
    }

    const toUnlink: string[] = []
    for (const filename of entries) {
      if (!filename.startsWith(FILENAME_PREFIX) || !filename.endsWith('.json')) continue
      const taskId = filename.slice(FILENAME_PREFIX.length, -'.json'.length)
      if (!liveTaskIds.has(taskId)) toUnlink.push(filename)
    }

    await Promise.all(
      toUnlink.map((filename) => rm(join(this.dataDir, filename), {force: true}).catch(() => {})),
    )
  }

  /**
   * Tombstone the given taskIds in a single index-append, then unlink each data file
   * in parallel. Order matters: tombstone first so list/getById skip the entry even
   * if the unlink fails (orphan data files are swept by M2.03 compaction). Reverse
   * order would leave the row visible to list while getById returns undefined.
   *
   * Atomicity: a single `appendFile` is POSIX-atomic up to ~4 KB (PIPE_BUF). One
   * tombstone is ~80 bytes, so this is safe up to ~50 ids per call. For larger
   * batches concurrent saves could interleave; M2.03 (compaction) is the right
   * place to add chunking if real workloads need it.
   *
   * Locked against `maybeCompact` via `operationLock` (B2): if our appendFile
   * landed mid-rewrite the tombstone would be wiped by `rename`, and our
   * subsequent unlink would orphan the index entry recoverPreRenameSaves
   * cannot detect (data file gone). Holding the lock for the entire append +
   * unlink sequence guarantees both are durable before any compaction
   * consumes the snapshot.
   */
  private async tombstoneAndUnlink(taskIds: readonly string[]): Promise<void> {
    if (taskIds.length === 0) return

    await this.withOperationLock(async () => {
      const now = Date.now()
      const lines = taskIds
        .map((taskId) =>
          JSON.stringify({_deleted: true, deletedAt: now, schemaVersion: TASK_HISTORY_SCHEMA_VERSION, taskId}) + '\n',
        )
        .join('')

      await appendFile(this.indexPath, lines, 'utf8')
      await Promise.all(
        taskIds.map((id) => rm(this.dataPath(id), {force: true}).catch(() => {})),
      )
      this.indexCache = undefined
    })
  }

  private async withOperationLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.operationLock
    // Lazy-init: the Promise constructor invokes its executor synchronously,
    // so `release` is guaranteed assigned before any await. CLAUDE.md exception
    // for definite-assignment in lazy-init patterns applies.
    let release!: () => void
    this.operationLock = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous
      return await fn()
    } finally {
      release()
    }
  }

  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, content, 'utf8')
      await rename(tmpPath, filePath)
    } catch (error) {
      await rm(tmpPath, {force: true}).catch(() => {})
      throw error
    }
  }
}

// ── Pure projection helpers ──────────────────────────────────────────────────

function projectToIndexLine(entry: TaskHistoryEntry): IndexDataLine {
  const line: IndexDataLine = {
    content: entry.content,
    createdAt: entry.createdAt,
    projectPath: entry.projectPath,
    schemaVersion: entry.schemaVersion,
    status: entry.status,
    taskId: entry.taskId,
    type: entry.type,
    ...(entry.files === undefined ? {} : {files: entry.files}),
    ...(entry.folderPath === undefined ? {} : {folderPath: entry.folderPath}),
    ...(entry.provider === undefined ? {} : {provider: entry.provider}),
    ...(entry.model === undefined ? {} : {model: entry.model}),
  }

  // Branch-aware extraction — `created` has no startedAt; terminal branches
  // have startedAt? optional and completedAt required (plus error payload on error).
  switch (entry.status) {
    case 'cancelled':
    case 'completed': {
      line.completedAt = entry.completedAt
      if (entry.startedAt !== undefined) line.startedAt = entry.startedAt
      break
    }

    case 'created': {
      break
    }

    case 'error': {
      line.completedAt = entry.completedAt
      line.error = entry.error
      if (entry.startedAt !== undefined) line.startedAt = entry.startedAt
      break
    }

    case 'started': {
      line.startedAt = entry.startedAt
      break
    }
  }

  return line
}

function toTaskListItem(line: IndexDataLine): TaskListItem {
  // Project the persisted summary into the wire-friendly shape.
  // Drops `schemaVersion` (storage detail) and never includes `id` /
  // heavy fields (already absent from the index).
  const {status} = line
  return {
    content: line.content,
    createdAt: line.createdAt,
    projectPath: line.projectPath,
    status,
    taskId: line.taskId,
    type: line.type,
    ...(line.completedAt === undefined ? {} : {completedAt: line.completedAt}),
    ...(line.startedAt === undefined ? {} : {startedAt: line.startedAt}),
    ...(line.files === undefined ? {} : {files: line.files}),
    ...(line.folderPath === undefined ? {} : {folderPath: line.folderPath}),
    ...(line.provider === undefined ? {} : {provider: line.provider}),
    ...(line.model === undefined ? {} : {model: line.model}),
    ...(line.error === undefined ? {} : {error: line.error}),
  }
}
