/* eslint-disable camelcase */
import {readFileSync} from 'node:fs'

import type {LlmToolResultEvent, TaskCreateRequest} from '../../core/domain/transport/schemas.js'
import type {TaskInfo} from '../../core/domain/transport/task-info.js'
import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'
import type {ITaskLifecycleHook} from '../../core/interfaces/process/i-task-lifecycle-hook.js'
import type {QueryResultMetadata} from './query-log-handler.js'

import {CliMetadataSchema} from '../../../shared/analytics/cli-metadata-schema.js'
import {AnalyticsEventNames} from '../../../shared/analytics/event-names.js'
import {parseFrontmatter} from '../../core/domain/knowledge/markdown-writer.js'
import {extractCurateOperations} from '../../utils/curate-result-parser.js'
import {processLog} from '../../utils/process-logger.js'
import {CURATE_TASK_TYPES} from './curate-log-handler.js'
import {QUERY_TASK_TYPES} from './query-log-handler.js'

// `CURATE_TASK_TYPES` is exported as a readonly tuple; wrap in a Set<string>
// for cast-free `.has()` lookups against TaskInfo.type (string).
const CURATE_TASK_TYPE_SET: ReadonlySet<string> = new Set(CURATE_TASK_TYPES)

const READ_FILE_TOOL = 'read_file'
const EXPAND_KNOWLEDGE_TOOL = 'expand_knowledge'
const SEARCH_KNOWLEDGE_TOOL = 'search_knowledge'

const MAX_READ_PATHS = 10
const MAX_FRONTMATTER_ARRAY_LENGTH = 50
const MAX_FRONTMATTER_STRING_LENGTH = 256

type FrontmatterFields = {
  keywords?: string[]
  related?: string[]
  tags?: string[]
}

/**
 * Clip a frontmatter array to schema caps: array length <= 50, per-entry
 * string length <= 256. Returns `undefined` when the input is not an array
 * or is empty (so the emit can OMIT the field instead of carrying `[]`).
 */
function capStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    strings.push(entry.length > MAX_FRONTMATTER_STRING_LENGTH ? entry.slice(0, MAX_FRONTMATTER_STRING_LENGTH) : entry)
    if (strings.length >= MAX_FRONTMATTER_ARRAY_LENGTH) break
  }

  return strings.length > 0 ? strings : undefined
}

type CurateTaskTypeLiteral = (typeof CURATE_TASK_TYPES)[number]

type CurateCounters = {
  added: number
  deleted: number
  failed: number
  merged: number
  pendingReview: number
  updated: number
}

type CurateTaskAnalyticsState = {
  counters: CurateCounters
  flavor: 'curate'
  taskType: CurateTaskTypeLiteral
}

type QueryTaskAnalyticsState = {
  flavor: 'query'
  queryMeta?: QueryResultMetadata
}

type TaskAnalyticsState = CurateTaskAnalyticsState | QueryTaskAnalyticsState

const isCurateLiteral = (value: string): value is CurateTaskTypeLiteral =>
  CURATE_TASK_TYPE_SET.has(value)

/**
 * Lifecycle hook that emits per-task analytics (curate_operation_applied,
 * curate_run_completed, query_completed) into the daemon's
 * `IAnalyticsClient`. Pure in-memory state keyed by `taskId`; no I/O of its own.
 *
 * Wired as a peer to `CurateLogHandler` / `QueryLogHandler` /
 * `TaskHistoryHook` inside `TaskRouter.lifecycleHooks[]`. Does NOT modify the
 * other handlers — read paths and curate-op accumulators are recomputed here
 * via the shared `extractCurateOperations` parser and `task.toolCalls[]`
 * shape, so analytics emit is decoupled from log persistence.
 *
 * M12.2 emits skeleton payloads (no frontmatter harvest). M12.3 layers
 * `tags` / `keywords` / `related` arrays onto the curate-op and per-read-path
 * payloads via a daemon-side post-op file read.
 */
type AnalyticsHookDeps = {
  /**
   * Returns the daemon's cached analytics-enabled flag. Used by M12.3 to
   * short-circuit frontmatter file reads when analytics is disabled (avoids
   * wasted disk I/O on top of the no-op `track()`). Defaults to `() => true`
   * in tests; production wires `() => globalConfigHandler.getCachedAnalytics()`.
   */
  isEnabled?: () => boolean
}

export class AnalyticsHook implements ITaskLifecycleHook {
  /** Lazy-injected by the daemon after `setupFeatureHandlers` constructs the client. */
  private analyticsClient?: IAnalyticsClient
  private readonly isEnabled: () => boolean
  /** In-memory state per active task. Cleared on cleanup(). */
  private readonly tasks = new Map<string, TaskAnalyticsState>()

  constructor(deps: AnalyticsHookDeps = {}) {
    this.isEnabled = deps.isEnabled ?? (() => true)
  }

  cleanup(taskId: string): void {
    this.tasks.delete(taskId)
  }

  async onTaskCancelled(taskId: string, task: TaskInfo): Promise<void> {
    this.dispatchTerminal(taskId, task, 'cancelled')
  }

  async onTaskCompleted(taskId: string, _result: string, task: TaskInfo): Promise<void> {
    const state = this.tasks.get(taskId)
    if (!state) return

    if (state.flavor === 'curate') {
      const outcome = state.counters.failed > 0 ? 'partial' : 'completed'
      this.emit(
        AnalyticsEventNames.CURATE_RUN_COMPLETED,
        this.buildCurateRunPayload({outcome, state, task, taskId}),
      )
    } else {
      this.emit(
        AnalyticsEventNames.QUERY_COMPLETED,
        this.buildQueryCompletedPayload({outcome: 'completed', state, task, taskId}),
      )
    }
  }

  async onTaskCreate(task: TaskInfo): Promise<void> {
    if (isCurateLiteral(task.type)) {
      this.tasks.set(task.taskId, {
        counters: {added: 0, deleted: 0, failed: 0, merged: 0, pendingReview: 0, updated: 0},
        flavor: 'curate',
        taskType: task.type,
      })
      return
    }

    if (QUERY_TASK_TYPES.has(task.type)) {
      this.tasks.set(task.taskId, {flavor: 'query'})
    }
  }

  /**
   * M13.1: emit `cli_invocation` once per inbound `task:create` request when
   * the caller attached a structurally-valid `cli_metadata` block. Daemon-
   * internal task creates (idle dispatch, agent fork) leave the block off and
   * silently no-op here.
   */
  async onTaskCreateRequest(request: TaskCreateRequest, _clientId: string): Promise<void> {
    const cliMeta = request.cli_metadata
    if (!cliMeta) return
    const parsed = CliMetadataSchema.safeParse(cliMeta)
    if (!parsed.success) return
    this.emit(AnalyticsEventNames.CLI_INVOCATION, parsed.data)
  }

  async onTaskError(taskId: string, _errorMessage: string, task: TaskInfo): Promise<void> {
    this.dispatchTerminal(taskId, task, 'error')
  }

  onToolResult(taskId: string, payload: LlmToolResultEvent): void {
    const state = this.tasks.get(taskId)
    if (!state || state.flavor !== 'curate') return

    const ops = extractCurateOperations(payload)
    for (const op of ops) {
      if (op.status !== 'success') {
        state.counters.failed++
        continue
      }

      // Bump counters per op.type. UPSERT counts as `added` when the message
      // hints at a new-file create (mirrors `computeSummary` in
      // curate-log-handler.ts); otherwise treat as an update.
      switch (op.type) {
        case 'ADD': {
          state.counters.added++
          break
        }

        case 'DELETE': {
          state.counters.deleted++
          break
        }

        case 'MERGE': {
          state.counters.merged++
          break
        }

        case 'UPDATE': {
          state.counters.updated++
          break
        }

        case 'UPSERT': {
          if (op.message?.includes('created new')) state.counters.added++
          else state.counters.updated++
          break
        }
      }

      if (op.needsReview === true) state.counters.pendingReview++

      // `op.filePath` is optional on CurateLogOperation but every M12 emit
      // requires absolute_path. Skip ops missing filePath so the daemon
      // never emits a malformed row (these are rare; UPSERT/MERGE without
      // a concrete file path would be the only realistic case).
      if (!op.filePath) continue

      // M12.3: read post-op frontmatter for ADD / UPDATE / MERGE-target /
      // UPSERT. DELETE skips the read (file is gone). Frontmatter fields
      // stay absent when the read fails (ENOENT, EACCES, malformed YAML).
      const frontmatter = op.type === 'DELETE' ? {} : this.readFrontmatterFields(op.filePath)

      this.emit(AnalyticsEventNames.CURATE_OPERATION_APPLIED, {
        absolute_path: op.filePath,
        ...(op.confidence ? {confidence: op.confidence} : {}),
        ...(op.impact ? {impact: op.impact} : {}),
        ...(frontmatter.keywords ? {keywords: frontmatter.keywords} : {}),
        knowledge_path: op.path,
        needs_review: op.needsReview ?? false,
        operation_type: op.type,
        ...(frontmatter.related ? {related: frontmatter.related} : {}),
        ...(frontmatter.tags ? {tags: frontmatter.tags} : {}),
        task_id: taskId,
      })
    }
  }

  /**
   * Wired by the daemon factory after `setupFeatureHandlers` constructs
   * the real `IAnalyticsClient`. Calls to `emit()` before this setter
   * runs silently no-op (no tasks are active during daemon boot).
   */
  setAnalyticsClient(client: IAnalyticsClient): void {
    this.analyticsClient = client
  }

  /**
   * Cache per-task query execution metadata for later finalization.
   * Symmetric to `QueryLogHandler.setQueryResult`. Called from the
   * `QUERY_RESULT` transport handler fan-out in `brv-server.ts`.
   */
  setQueryResult(taskId: string, metadata: QueryResultMetadata): void {
    const state = this.tasks.get(taskId)
    if (!state || state.flavor !== 'query') return
    state.queryMeta = metadata
  }

  private buildCurateRunPayload({
    outcome,
    state,
    task,
    taskId,
  }: {
    outcome: 'cancelled' | 'completed' | 'error' | 'partial'
    state: CurateTaskAnalyticsState
    task: TaskInfo
    taskId: string
  }): Record<string, unknown> {
    return {
      duration_ms: this.durationMs(task),
      operations_added: state.counters.added,
      operations_deleted: state.counters.deleted,
      operations_failed: state.counters.failed,
      operations_merged: state.counters.merged,
      operations_updated: state.counters.updated,
      outcome,
      pending_review_count: state.counters.pendingReview,
      task_id: taskId,
      task_type: state.taskType,
    }
  }

  private buildQueryCompletedPayload({
    outcome,
    state,
    task,
    taskId,
  }: {
    outcome: 'cancelled' | 'completed' | 'error'
    state: QueryTaskAnalyticsState
    task: TaskInfo
    taskId: string
  }): Record<string, unknown> {
    const readPaths = new Set<string>()
    let readToolCallCount = 0
    let searchCallCount = 0

    for (const call of task.toolCalls ?? []) {
      // `call.args` is a required `Record<string, unknown>` on ToolCallEvent;
      // index access returns `unknown` (possibly undefined when the key is
      // absent), so the runtime `typeof === 'string'` check below is what
      // actually narrows. No optional chain on `args` itself.
      switch (call.toolName) {
        case EXPAND_KNOWLEDGE_TOOL: {
          readToolCallCount++
          const {overviewPath, stubPath} = call.args
          if (typeof stubPath === 'string' && stubPath.length > 0) readPaths.add(stubPath)
          if (typeof overviewPath === 'string' && overviewPath.length > 0) readPaths.add(overviewPath)

          break
        }

        case READ_FILE_TOOL: {
          readToolCallCount++
          const {filePath} = call.args
          if (typeof filePath === 'string' && filePath.length > 0) readPaths.add(filePath)

          break
        }

        case SEARCH_KNOWLEDGE_TOOL: {
          searchCallCount++

          break
        }
        // No default
      }
    }

    const cappedPaths = [...readPaths].sort().slice(0, MAX_READ_PATHS)
    const tier = state.queryMeta?.tier
    const matchedDocCount = state.queryMeta?.searchMetadata?.resultCount ?? 0

    // M12.3: harvest per-path frontmatter on the same sync read path used
    // for curate emits. Entries whose file is unreadable / has no frontmatter
    // carry `absolute_path` alone (the three array fields stay absent).
    const readPathsWithMetadata = cappedPaths.map((p) => {
      const fm = this.readFrontmatterFields(p)
      return {
        absolute_path: p,
        ...(fm.keywords ? {keywords: fm.keywords} : {}),
        ...(fm.related ? {related: fm.related} : {}),
        ...(fm.tags ? {tags: fm.tags} : {}),
      }
    })

    return {
      cache_hit: tier === 0 || tier === 1,
      duration_ms: this.durationMs(task),
      matched_doc_count: matchedDocCount,
      outcome,
      read_doc_count: readPaths.size,
      // M12.1 schema marks read_paths_with_metadata as optional outer array.
      // Mirror that: omit the field when the command had no read paths
      // (instead of emitting an empty array). Same idiom as `tier` above.
      ...(readPathsWithMetadata.length > 0 ? {read_paths_with_metadata: readPathsWithMetadata} : {}),
      read_tool_call_count: readToolCallCount,
      search_call_count: searchCallCount,
      task_id: taskId,
      task_type: 'query',
      ...(tier === undefined ? {} : {tier}),
    }
  }

  private dispatchTerminal(taskId: string, task: TaskInfo, outcome: 'cancelled' | 'error'): void {
    const state = this.tasks.get(taskId)
    if (!state) return

    if (state.flavor === 'curate') {
      this.emit(
        AnalyticsEventNames.CURATE_RUN_COMPLETED,
        this.buildCurateRunPayload({outcome, state, task, taskId}),
      )
    } else {
      this.emit(
        AnalyticsEventNames.QUERY_COMPLETED,
        this.buildQueryCompletedPayload({outcome, state, task, taskId}),
      )
    }
  }

  private durationMs(task: TaskInfo): number {
    return Math.max(0, (task.completedAt ?? Date.now()) - task.createdAt)
  }

  private emit(event: string, properties: Record<string, unknown>): void {
    const client = this.analyticsClient
    if (!client) return
    try {
      client.track(event, properties)
    } catch (error) {
      processLog(`AnalyticsHook: ${event} track failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Read the YAML frontmatter from `filePath` and return only `tags` /
   * `keywords` / `related` arrays (capped at 50 entries / 256 chars per
   * entry). Returns an empty object on ANY failure: ENOENT, EACCES,
   * permission errors, malformed YAML. Telemetry MUST NOT crash the hook.
   *
   * Synchronous I/O on local disk: a single read is sub-millisecond on
   * SSD; curate runs emit at most one read per op, query at most ten
   * reads at task completion. The blocking cost is negligible against
   * the analytics value of the harvested metadata.
   *
   * Short-circuits when analytics is disabled to avoid wasted disk I/O.
   */
  private readFrontmatterFields(filePath: string): FrontmatterFields {
    if (!this.isEnabled()) return {}
    try {
      const content = readFileSync(filePath, 'utf8')
      const parsed = parseFrontmatter(content)
      if (parsed === null) return {}
      return {
        keywords: capStringArray(parsed.frontmatter.keywords),
        related: capStringArray(parsed.frontmatter.related),
        tags: capStringArray(parsed.frontmatter.tags),
      }
    } catch {
      // ENOENT, EACCES, permission, malformed YAML — all silently treated
      // as "no frontmatter". No retry, no log noise.
      return {}
    }
  }
}
