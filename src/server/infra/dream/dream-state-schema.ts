import {z} from 'zod'

export const PendingMergeSchema = z.object({
  mergeTarget: z.string(),
  reason: z.string(),
  sourceFile: z.string(),
  suggestedByDreamId: z.string(),
})

/**
 * One entry in the stale-summary queue drained at the next dream cycle.
 * `enqueuedAt` is preserved across dedup'd re-enqueues so future telemetry
 * (e.g., "oldest waiting path") can read meaningful wait times even though
 * no consumer reads it today.
 */
export const StaleSummaryEntrySchema = z.object({
  enqueuedAt: z.number().int().nonnegative(),
  path: z.string(),
})

export const DreamStateSchema = z.object({
  curationsSinceDream: z.number().int().min(0),
  lastDreamAt: z.string().datetime().nullable(),
  lastDreamLogId: z.string().nullable(),
  pendingMerges: z.array(PendingMergeSchema).optional().default([]),
  staleSummaryPaths: z.array(StaleSummaryEntrySchema).optional().default([]),
  totalDreams: z.number().int().min(0),
  version: z.literal(1),
})

export type DreamState = z.infer<typeof DreamStateSchema>
export type PendingMerge = z.infer<typeof PendingMergeSchema>
export type StaleSummaryEntry = z.infer<typeof StaleSummaryEntrySchema>

export const EMPTY_DREAM_STATE: DreamState = {
  curationsSinceDream: 0,
  lastDreamAt: null,
  lastDreamLogId: null,
  pendingMerges: [],
  staleSummaryPaths: [],
  totalDreams: 0,
  version: 1,
}
