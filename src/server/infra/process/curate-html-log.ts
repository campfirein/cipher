import type {CurateMeta} from '../../../shared/curate-meta.js'
import type {CurateLogEntry, CurateLogOperation} from '../../core/domain/entities/curate-log-entry.js'
import type {HtmlWriteResult} from '../render/writer/html-writer.js'

import {computeSummary} from './curate-log-handler.js'

/**
 * Default `input.context` sentinel for tool-mode curates that don't carry
 * a user-intent string (MCP calls — the agent typed the HTML directly,
 * there was no `brv curate "<text>"` kickoff). The TUI / `brv curate view`
 * renders this so the log row isn't visually empty.
 */
const DEFAULT_TOOL_MODE_INTENT = '<curated via tool mode>'

const FALLBACK_PATH = '<unknown>'

type BuildInput = {
  /** Wall-clock at write completion (write success OR validation failure). */
  completedAt: number
  /** Whether the caller passed --overwrite / `confirmOverwrite: true`. */
  confirmOverwrite: boolean
  /** Whether a file already existed at the resolved path BEFORE this write. Used to default `type`. */
  existedBefore: boolean
  /** Relative path of the written topic file (e.g. `security/auth.html`). May be undefined on validation failure. */
  filePath?: string
  /** Pre-allocated log id from `FileCurateLogStore.getNextId()` (`cur-<timestamp_ms>` format). */
  id: string
  /** User intent string (CLI kickoff text). MCP calls have no intent — leave undefined to use the sentinel. */
  intent?: string
  /** Agent-supplied operation metadata. Optional. */
  meta?: CurateMeta
  /** Snapshot of project's reviewDisabled flag at task-create time. */
  reviewDisabled: boolean
  /** Wall-clock at write start. */
  startedAt: number
  /** Task id correlating this log entry with its task. */
  taskId: string
  /** Topic path (`security/auth`, no `.html`). May be undefined on validation failure. */
  topicPath?: string
  /** Result from `writeHtmlTopic`. */
  writeResult: HtmlWriteResult
}

/**
 * Build a `CurateLogEntry` for a single tool-mode curate write.
 *
 * Pure — no I/O. The caller persists via `FileCurateLogStore.save()`.
 * The log entry id MUST be pre-allocated via `store.getNextId()` so the
 * resulting filename matches `FileCurateLogStore`'s `ID_PATTERN`
 * (`cur-<timestamp_ms>`); a random UUID would silently produce an entry
 * that `list()` and `getById()` cannot find.
 *
 * Both the daemon's `curate-html-direct` handler and the CLI's
 * `continueSession` use this helper so the on-disk log shape stays
 * identical regardless of which surface initiated the curate.
 *
 * Review semantics:
 *   - `needsReview` is `meta.impact === 'high' && !reviewDisabled && status === 'success'`.
 *   - `reviewStatus` is `'pending'` when `needsReview`, else undefined.
 *   - On failure the entry is still written (with `status: 'error'`) for
 *     telemetry, but no review surfacing — failed writes aren't actionable
 *     and surfacing them would create noise in `brv review pending`.
 */
export function buildCurateHtmlLogEntry(input: BuildInput): CurateLogEntry {
  const {
    completedAt,
    confirmOverwrite,
    existedBefore,
    filePath,
    id,
    intent,
    meta,
    reviewDisabled,
    startedAt,
    taskId,
    topicPath,
    writeResult,
  } = input

  const operation = writeResult.ok
    ? buildSuccessOperation({confirmOverwrite, existedBefore, filePath, meta, reviewDisabled, topicPath})
    : buildFailureOperation({filePath, meta, topicPath, writeResult})

  const base = {
    format: 'html' as const,
    id,
    input: {context: intent ?? DEFAULT_TOOL_MODE_INTENT},
    operations: [operation],
    startedAt,
    summary: computeSummary([operation]),
    taskId,
  }

  if (writeResult.ok) {
    return {...base, completedAt, status: 'completed'}
  }

  return {
    ...base,
    completedAt,
    error: writeResult.errors.map((e) => `${e.kind}: ${e.message}`).join('\n'),
    status: 'error',
  }
}

function buildSuccessOperation(args: {
  confirmOverwrite: boolean
  existedBefore: boolean
  filePath?: string
  meta?: CurateMeta
  reviewDisabled: boolean
  topicPath?: string
}): CurateLogOperation {
  const {confirmOverwrite, existedBefore, filePath, meta, reviewDisabled, topicPath} = args
  const derivedType = existedBefore && confirmOverwrite ? 'UPDATE' : 'ADD'
  const needsReview = meta?.impact === 'high' && !reviewDisabled

  const op: CurateLogOperation = {
    path: topicPath ?? FALLBACK_PATH,
    status: 'success',
    type: meta?.type ?? derivedType,
  }

  if (filePath !== undefined) op.filePath = filePath
  if (meta?.impact !== undefined) op.impact = meta.impact
  if (meta?.confidence !== undefined) op.confidence = meta.confidence
  if (meta?.reason !== undefined) op.reason = meta.reason
  if (meta?.summary !== undefined) op.summary = meta.summary
  if (meta?.previousSummary !== undefined) op.previousSummary = meta.previousSummary

  // Only emit needsReview when the agent asserted impact. No meta = no
  // review-worthiness judgment, so the field stays undefined rather than
  // an explicit `false` (which would conflate "agent said low" with
  // "agent didn't say anything").
  if (meta?.impact !== undefined) {
    op.needsReview = needsReview
    if (needsReview) op.reviewStatus = 'pending'
  }

  return op
}

function buildFailureOperation(args: {
  filePath?: string
  meta?: CurateMeta
  topicPath?: string
  writeResult: Extract<HtmlWriteResult, {ok: false}>
}): CurateLogOperation {
  const {filePath, meta, topicPath, writeResult} = args

  const op: CurateLogOperation = {
    needsReview: false,
    path: topicPath ?? FALLBACK_PATH,
    status: 'failed',
    type: meta?.type ?? 'ADD',
  }

  if (filePath !== undefined) op.filePath = filePath
  if (meta?.impact !== undefined) op.impact = meta.impact
  if (meta?.confidence !== undefined) op.confidence = meta.confidence
  if (meta?.reason !== undefined) op.reason = meta.reason
  if (meta?.summary !== undefined) op.summary = meta.summary
  if (meta?.previousSummary !== undefined) op.previousSummary = meta.previousSummary

  op.message = writeResult.errors.map((e) => `${e.kind}: ${e.message}`).join('\n')

  return op
}
