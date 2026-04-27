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
import {appendFile, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {TaskListItem} from '../../../shared/transport/events/task-events.js'
import type {TaskHistoryEntry} from '../../core/domain/entities/task-history-entry.js'
import type {ITaskHistoryStore, TaskHistoryStatus} from '../../core/interfaces/storage/i-task-history-store.js'

import {TASK_HISTORY_DIR} from '../../constants.js'
import {TASK_HISTORY_SCHEMA_VERSION, TaskHistoryEntrySchema} from '../../core/domain/entities/task-history-entry.js'
import {TaskErrorDataSchema} from '../../core/domain/transport/schemas.js'

const STATUS_VALUES = ['cancelled', 'completed', 'created', 'error', 'started'] as const
const StatusSchema = z.enum(STATUS_VALUES)

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

/** Tombstone written by M2.05 delete/clear. List skips taskIds whose final line is a tombstone. */
const IndexTombstoneSchema = z.object({
  _deleted: z.literal(true),
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
}

export class FileTaskHistoryStore implements ITaskHistoryStore {
  private readonly dataDir: string
  /** Dedup-by-taskId result of the last index read. Invalidated on save (M2.05: delete/clear). */
  private indexCache: Map<string, IndexLine> | undefined
  private readonly indexPath: string
  private readonly storeDir: string

  constructor(opts: FileTaskHistoryStoreOptions) {
    this.storeDir = join(opts.baseDir, TASK_HISTORY_DIR)
    this.indexPath = join(this.storeDir, INDEX_FILE)
    this.dataDir = join(this.storeDir, DATA_DIR)
  }

  // ── Stub methods for M2.05 — present to satisfy the interface contract ─────

  async clear(): Promise<{deletedCount: number; taskIds: string[]}> {
    throw new Error('FileTaskHistoryStore.clear() not implemented (lands in M2.05)')
  }

  async delete(_taskId: string): Promise<boolean> {
    throw new Error('FileTaskHistoryStore.delete() not implemented (lands in M2.05)')
  }

  async deleteMany(_taskIds: string[]): Promise<{deletedCount: number; taskIds: string[]}> {
    throw new Error('FileTaskHistoryStore.deleteMany() not implemented (lands in M2.05)')
  }

  // ── M2.02 scope ────────────────────────────────────────────────────────────

  async getById(taskId: string): Promise<TaskHistoryEntry | undefined> {
    if (!TASK_ID_PATTERN.test(taskId)) return undefined

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

    // Step 2: append the summary line (single ≤4KB POSIX append, atomic per PIPE_BUF).
    const summary = projectToIndexLine(validated)
    await appendFile(this.indexPath, JSON.stringify(summary) + '\n', 'utf8')

    this.indexCache = undefined
  }

  private dataPath(taskId: string): string {
    return join(this.dataDir, `${FILENAME_PREFIX}${taskId}.json`)
  }

  private async readIndexDedup(): Promise<Map<string, IndexLine>> {
    if (this.indexCache) return this.indexCache

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

    this.indexCache = map
    return map
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
