import {z} from 'zod'

// ── Operation schemas (discriminated on type) ────────────────────────────────

const ConsolidateOperationSchema = z.object({
  action: z.enum(['MERGE', 'TEMPORAL_UPDATE', 'CROSS_REFERENCE']),
  inputFiles: z.array(z.string()),
  needsReview: z.boolean(),
  outputFile: z.string().optional(),
  previousTexts: z.record(z.string(), z.string()).optional(),
  reason: z.string(),
  type: z.literal('CONSOLIDATE'),
})

const SynthesizeOperationSchema = z.object({
  action: z.enum(['CREATE', 'UPDATE']),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  outputFile: z.string(),
  sources: z.array(z.string()),
  type: z.literal('SYNTHESIZE'),
})

const PruneOperationSchema = z.object({
  action: z.enum(['ARCHIVE', 'KEEP', 'SUGGEST_MERGE']),
  file: z.string(),
  mergeTarget: z.string().optional(),
  needsReview: z.boolean(),
  reason: z.string(),
  type: z.literal('PRUNE'),
})

export const DreamOperationSchema = z.discriminatedUnion('type', [
  ConsolidateOperationSchema,
  SynthesizeOperationSchema,
  PruneOperationSchema,
])

export type DreamOperation = z.infer<typeof DreamOperationSchema>

// ── Summary schema ───────────────────────────────────────────────────────────

export const DreamLogSummarySchema = z.object({
  consolidated: z.number().int().min(0),
  errors: z.number().int().min(0),
  flaggedForReview: z.number().int().min(0),
  pruned: z.number().int().min(0),
  synthesized: z.number().int().min(0),
})

export type DreamLogSummary = z.infer<typeof DreamLogSummarySchema>

// ── Entry schema (discriminated on status) ───────────────────────────────────

const DreamLogEntryBaseSchema = z.object({
  id: z.string().regex(/^drm-\d+$/),
  operations: z.array(DreamOperationSchema),
  startedAt: z.number(),
  summary: DreamLogSummarySchema,
  trigger: z.enum(['agent-idle', 'manual', 'cli']),
})

export const DreamLogEntrySchema = z.discriminatedUnion('status', [
  DreamLogEntryBaseSchema.extend({completedAt: z.number(), status: z.literal('completed')}),
  DreamLogEntryBaseSchema.extend({abortReason: z.string(), completedAt: z.number(), status: z.literal('partial')}),
  DreamLogEntryBaseSchema.extend({completedAt: z.number(), error: z.string(), status: z.literal('error')}),
  DreamLogEntryBaseSchema.extend({status: z.literal('processing')}),
  DreamLogEntryBaseSchema.extend({completedAt: z.number(), status: z.literal('undone'), undoneAt: z.number()}),
])

export type DreamLogEntry = z.infer<typeof DreamLogEntrySchema>
export type DreamLogStatus = DreamLogEntry['status']
