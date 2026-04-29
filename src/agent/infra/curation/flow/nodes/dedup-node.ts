/**
 * Dedup node — pure JS, no LLM.
 *
 * Wraps `dedup()` from src/agent/infra/sandbox/curation-helpers.ts.
 * Phase 1: flattens grouped facts and applies Jaccard similarity dedup
 * (threshold = 0.85). The tier-S reranker for tie-break is a Phase-2+
 * concern — see plan/curate-flow/IMPLEMENTATION.md.
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {dedupInputSchema, dedupOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

import {dedup as dedupHelper} from '../../../sandbox/curation-helpers.js'

export type DedupInput = z.infer<typeof dedupInputSchema>
export type DedupOutput = z.infer<typeof dedupOutputSchema>

export function createDedupNode(id = 'dedup'): CurationNode<DedupInput, DedupOutput> {
  return {
    async execute(input: DedupInput, _ctx: NodeContext): Promise<DedupOutput> {
      const flat = Object.values(input.grouped).flat()
      const deduped = dedupHelper(flat)
      return {deduped}
    },
    id,
    slot: 'dedup',
  }
}
