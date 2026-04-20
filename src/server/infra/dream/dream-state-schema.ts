import {z} from 'zod'

export const PendingMergeSchema = z.object({
  mergeTarget: z.string(),
  reason: z.string(),
  sourceFile: z.string(),
  suggestedByDreamId: z.string(),
})

export const DreamStateSchema = z.object({
  curationsSinceDream: z.number().int().min(0),
  lastDreamAt: z.string().datetime().nullable(),
  lastDreamLogId: z.string().nullable(),
  pendingMerges: z.array(PendingMergeSchema).optional().default([]),
  totalDreams: z.number().int().min(0),
  version: z.literal(1),
})

export type DreamState = z.infer<typeof DreamStateSchema>
export type PendingMerge = z.infer<typeof PendingMergeSchema>

export const EMPTY_DREAM_STATE: DreamState = {
  curationsSinceDream: 0,
  lastDreamAt: null,
  lastDreamLogId: null,
  pendingMerges: [],
  totalDreams: 0,
  version: 1,
}
