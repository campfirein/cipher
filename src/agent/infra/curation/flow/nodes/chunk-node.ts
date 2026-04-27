/**
 * Chunk node — pure JS, no LLM.
 *
 * Wraps `chunk()` from src/agent/infra/sandbox/curation-helpers.ts.
 * Phase 1: takes recon's full output as edge input (uses `suggestedChunkCount`
 * from it) and pulls the original text from `ctx.initialInput.context`.
 *
 * The runner threads slot-specific data via edges; shared run state
 * (original context) lives in `ctx.initialInput`. We narrow that
 * `unknown`-typed payload via Zod `safeParse` (no `as` casts).
 */

import {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {chunkInputSchema, chunkOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

import {chunk as chunkHelper} from '../../../sandbox/curation-helpers.js'

export type ChunkInput = z.infer<typeof chunkInputSchema>
export type ChunkOutput = z.infer<typeof chunkOutputSchema>

const initialInputContextSchema = z.object({context: z.string()}).partial()

function readContextFromCtx(ctx: NodeContext): string {
  const parsed = initialInputContextSchema.safeParse(ctx.initialInput)
  return parsed.success && typeof parsed.data.context === 'string' ? parsed.data.context : ''
}

export function createChunkNode(id = 'chunk'): CurationNode<ChunkInput, ChunkOutput> {
  return {
    async execute(input: ChunkInput, ctx: NodeContext): Promise<ChunkOutput> {
      const context = readContextFromCtx(ctx)

      if (!context || context.length === 0) {
        return {boundaries: [], chunks: [], totalChunks: 0}
      }

      const target = input.suggestedChunkCount > 0 ? input.suggestedChunkCount : 1
      const size = target === 1 ? context.length : Math.ceil(context.length / target)

      const result = chunkHelper(context, {size})
      return {
        boundaries: result.boundaries,
        chunks: result.chunks,
        totalChunks: result.totalChunks,
      }
    },
    id,
    slot: 'chunk',
  }
}
