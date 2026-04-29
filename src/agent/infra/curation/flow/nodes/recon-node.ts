/**
 * Recon node — pure JS in Phase 1.
 *
 * Wraps `recon()` from src/agent/infra/sandbox/curation-helpers.ts.
 * The helper is fully deterministic (character-count thresholds + history
 * summarization). Phase 1 ships this verbatim. The plan allows future
 * LLM refinement of `suggestedMode` / `suggestedChunkCount` on edge
 * cases — that's a Phase 2+ enhancement, not blocking Phase 1.
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {reconInputSchema, reconOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

import {recon as reconHelper} from '../../../sandbox/curation-helpers.js'

export type ReconInput = z.infer<typeof reconInputSchema>
export type ReconOutput = z.infer<typeof reconOutputSchema>

export function createReconNode(id = 'recon'): CurationNode<ReconInput, ReconOutput> {
  return {
    async execute(input: ReconInput, _ctx: NodeContext): Promise<ReconOutput> {
      const result = reconHelper(input.context, input.meta, input.history)
      return {
        headPreview: result.headPreview,
        history: result.history,
        meta: result.meta,
        suggestedChunkCount: result.suggestedChunkCount,
        suggestedMode: result.suggestedMode,
        tailPreview: result.tailPreview,
      }
    },
    id,
    slot: 'recon',
  }
}
