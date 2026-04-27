/**
 * Conflict node — service-bound (LLM via `services.detectConflicts`).
 *
 * Receives dedup's output (`{deduped: CurationFact[]}`). The service is
 * responsible for sourcing the existing-memory comparison set itself
 * (e.g., via SearchKnowledgeService); the node does not pass it.
 *
 * Phase 1: single-shot detection. Fail-open: if the service throws, every
 * input fact becomes an `add` decision so the run keeps moving forward.
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {conflictInputSchema, conflictOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

export type ConflictInput = z.infer<typeof conflictInputSchema>
export type ConflictOutput = z.infer<typeof conflictOutputSchema>

export function createConflictNode(id = 'conflict'): CurationNode<ConflictInput, ConflictOutput> {
  return {
    async execute(input: ConflictInput, ctx: NodeContext): Promise<ConflictOutput> {
      // Empty input — short-circuit (no LLM call needed).
      if (input.deduped.length === 0) {
        return {decisions: []}
      }

      if (!ctx.services?.detectConflicts) {
        throw new Error(
          'conflict node requires ctx.services.detectConflicts — no conflict-detection service provided',
        )
      }

      try {
        return await ctx.services.detectConflicts(input.deduped)
      } catch {
        // Fail-open: every input fact becomes an add decision.
        return {
          decisions: input.deduped.map((fact) => ({action: 'add' as const, fact})),
        }
      }
    },
    id,
    slot: 'conflict',
  }
}
