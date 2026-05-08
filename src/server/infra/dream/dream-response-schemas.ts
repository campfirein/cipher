import {z} from 'zod'

// ── Consolidate ──────────────────────────────────────────────────────────────

export const ConsolidationActionSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
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

// Bounds are slightly above the prompt's soft targets (200 chars / 3-5 tags /
// 5-10 keywords) so a model that goes a little over still produces a usable
// synthesis instead of being rejected outright; the caps still prevent a
// runaway model from landing oversized text directly in card-mode YAML.
export const SynthesisCandidateSchema = z.object({
  claim: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    domain: z.string(),
    fact: z.string(),
  })),
  keywords: z.array(z.string()).max(15),
  placement: z.string(),
  summary: z.string().max(500),
  tags: z.array(z.string()).max(8),
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
