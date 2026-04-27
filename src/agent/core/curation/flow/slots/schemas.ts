/**
 * Zod schemas for the 7 default slots' I/O.
 *
 * These mirror runtime shapes produced by the actual curation helpers and
 * tools (NOT a curated subset). Schemas serve as the future Phase 2
 * enforcement boundary, so they must accept what the default impls
 * actually produce — otherwise the runner/sandbox will reject valid
 * outputs or silently drop required fields.
 *
 * Reference shapes:
 *   recon()        → src/agent/infra/sandbox/curation-helpers.ts (ReconResult)
 *   chunk()        → src/agent/infra/sandbox/curation-helpers.ts (ChunkResult)
 *   mapExtract()   → src/agent/infra/sandbox/tools-sdk.ts:184 (returns facts/succeeded/failed/total)
 *   groupBySubject → src/agent/infra/sandbox/curation-helpers.ts (Record<string, CurationFact[]>)
 *   dedup()        → src/agent/infra/sandbox/curation-helpers.ts (CurationFact[])
 *   tools.curate() → src/agent/infra/tools/implementations/curate-tool.ts (CurateOutput: {applied, summary})
 *
 * `CurationFact` (helpers) intentionally omits the `value` field that
 * `CurateFact` (interfaces/i-curate-service.ts) carries — runtime extraction
 * only produces category/statement/subject.
 */

import {z} from 'zod'

const curationFactSchema = z.object({
  category: z
    .enum(['convention', 'environment', 'other', 'personal', 'preference', 'project', 'team'])
    .optional(),
  statement: z.string(),
  subject: z.string().optional(),
})

const conflictDecisionSchema = z.object({
  action: z.enum(['add', 'update', 'merge', 'skip']),
  existingId: z.string().optional(),
  fact: curationFactSchema,
  reason: z.string().optional(),
})

/**
 * Mirrors `OperationResult` produced by `executeCurate`.
 * See src/agent/infra/tools/implementations/curate-tool.ts:403.
 *
 * Required at runtime: confidence, impact, needsReview, path, reason, status, type.
 * Status is only ever 'success' | 'failed' — NOT 'applied' | 'pending' | 'skipped'.
 * Optional: additionalFilePaths, filePath, message, previousSummary, summary.
 */
const appliedOpSchema = z.object({
  additionalFilePaths: z.array(z.string()).optional(),
  confidence: z.enum(['high', 'low']),
  filePath: z.string().optional(),
  impact: z.enum(['high', 'low']),
  message: z.string().optional(),
  needsReview: z.boolean(),
  path: z.string(),
  previousSummary: z.string().optional(),
  reason: z.string(),
  status: z.enum(['failed', 'success']),
  summary: z.string().optional(),
  type: z.enum(['ADD', 'DELETE', 'MERGE', 'UPDATE', 'UPSERT']),
})

const curateSummarySchema = z.object({
  added: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
})

// ---------------------------------------------------------------------------
// recon — mirrors `ReconResult` from curation-helpers.ts
// ---------------------------------------------------------------------------

export const reconInputSchema = z.object({
  context: z.string(),
  history: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), z.unknown()),
})

export const reconOutputSchema = z.object({
  headPreview: z.string(),
  history: z.object({
    domains: z.record(z.string(), z.array(z.string())),
    totalProcessed: z.number().int().nonnegative(),
  }),
  meta: z.object({
    charCount: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
  }),
  suggestedChunkCount: z.number().int().nonnegative(),
  suggestedMode: z.enum(['single-pass', 'chunked']),
  tailPreview: z.string(),
})

// ---------------------------------------------------------------------------
// chunk — input is recon's output. The original `context` is pulled from
// `ctx.initialInput.context` rather than threaded via the edge (DAG runners
// pass single-predecessor output verbatim; threading context separately
// would force every downstream slot to repeat fields it doesn't use).
// ---------------------------------------------------------------------------

export const chunkInputSchema = reconOutputSchema

export const chunkOutputSchema = z.object({
  boundaries: z.array(z.object({end: z.number().int(), start: z.number().int()})),
  chunks: z.array(z.string()),
  totalChunks: z.number().int().nonnegative(),
})

// ---------------------------------------------------------------------------
// extract — input is chunk's output. Node loops over `input.chunks` and
// invokes the extract service per chunk; `taskId` comes from `ctx.taskId`.
// Phase 1 is sequential (concurrency = 1); Phase 2 fans out N parallel
// extract-node instances via the runner.
// ---------------------------------------------------------------------------

export const extractInputSchema = chunkOutputSchema

export const extractOutputSchema = z.object({
  facts: z.array(curationFactSchema),
  failed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

// ---------------------------------------------------------------------------
// group — input is extract's output (uses `facts`, ignores counts).
// Wraps `groupBySubject` from curation-helpers.ts in `{grouped: ...}` for
// uniform DAG-edge output shape.
// ---------------------------------------------------------------------------

export const groupInputSchema = extractOutputSchema

export const groupOutputSchema = z.object({
  grouped: z.record(z.string(), z.array(curationFactSchema)),
})

// ---------------------------------------------------------------------------
// dedup — input is group's output. Output uses `{deduped: ...}` so the
// downstream conflict slot can clearly distinguish "post-dedup" facts.
// ---------------------------------------------------------------------------

export const dedupInputSchema = groupOutputSchema

export const dedupOutputSchema = z.object({
  deduped: z.array(curationFactSchema),
})

// ---------------------------------------------------------------------------
// conflict — input is dedup's output. The existing-memory comparison set
// is pulled from `ctx.initialInput.existing` (or empty if absent), not from
// the edge. Phase 1 is single-shot detection; self-consistency vote lands
// in a later phase per the original curate-flow plan.
// ---------------------------------------------------------------------------

export const conflictInputSchema = dedupOutputSchema

export const conflictOutputSchema = z.object({
  decisions: z.array(conflictDecisionSchema),
})

// ---------------------------------------------------------------------------
// write — mirrors `executeCurate` return shape from curate-tool.ts
// ---------------------------------------------------------------------------

export const writeInputSchema = z.object({
  decisions: z.array(conflictDecisionSchema),
})

export const writeOutputSchema = z.object({
  applied: z.array(appliedOpSchema),
  summary: curateSummarySchema,
})
