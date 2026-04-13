import {z} from 'zod'

// ── Consolidate ──────────────────────────────────────────────────────────────

export const ConsolidationActionSchema = z.object({
  files: z.array(z.string()).min(1),
  mergedContent: z.string().optional(),
  outputFile: z.string().optional(),
  reason: z.string(),
  type: z.enum(['MERGE', 'TEMPORAL_UPDATE', 'CROSS_REFERENCE', 'SKIP']),
  updatedContent: z.string().optional(),
})

export const ConsolidateResponseSchema = z.object({
  actions: z.array(ConsolidationActionSchema),
})

export type ConsolidationAction = z.infer<typeof ConsolidationActionSchema>
export type ConsolidateResponse = z.infer<typeof ConsolidateResponseSchema>

// ── Synthesize ───────────────────────────────────────────────────────────────

export const SynthesisCandidateSchema = z.object({
  claim: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    domain: z.string(),
    fact: z.string(),
  })),
  placement: z.string(),
  title: z.string(),
})

export const SynthesizeResponseSchema = z.object({
  syntheses: z.array(SynthesisCandidateSchema),
})

export type SynthesisCandidate = z.infer<typeof SynthesisCandidateSchema>
export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>

// ── Prune ────────────────────────────────────────────────────────────────────

export const PruneDecisionSchema = z.object({
  decision: z.enum(['ARCHIVE', 'KEEP', 'MERGE_INTO']),
  file: z.string(),
  mergeTarget: z.string().optional(),
  reason: z.string(),
})

export const PruneResponseSchema = z.object({
  decisions: z.array(PruneDecisionSchema),
})

export type PruneDecision = z.infer<typeof PruneDecisionSchema>
export type PruneResponse = z.infer<typeof PruneResponseSchema>
