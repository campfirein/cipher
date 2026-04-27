/**
 * Extract node — service-bound (LLM via `services.extract`).
 *
 * Phase 1 takes chunk's output as edge input and loops over `input.chunks`
 * sequentially (`concurrency = 1`). `taskId` comes from `ctx.taskId`.
 * Aggregates per-chunk extraction into a single output.
 *
 * Phase 2 will replace this loop with multiple extract-node instances
 * fanned out by the runner — at that point this node's body becomes the
 * single-chunk path. The slot output schema does not change.
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {extractInputSchema, extractOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

export type ExtractInput = z.infer<typeof extractInputSchema>
export type ExtractOutput = z.infer<typeof extractOutputSchema>

export function createExtractNode(id = 'extract'): CurationNode<ExtractInput, ExtractOutput> {
  return {
    async execute(input: ExtractInput, ctx: NodeContext): Promise<ExtractOutput> {
      if (input.chunks.length === 0) {
        return {facts: [], failed: 0, succeeded: 0, total: 0}
      }

      if (!ctx.services?.extract) {
        throw new Error(
          'extract node requires ctx.services.extract — no extraction service provided',
        )
      }

      const aggregate: ExtractOutput = {facts: [], failed: 0, succeeded: 0, total: 0}
      for (const chunk of input.chunks) {
        // eslint-disable-next-line no-await-in-loop
        const partial = await ctx.services.extract(chunk, ctx.taskId)
        aggregate.facts.push(...partial.facts)
        aggregate.failed += partial.failed
        aggregate.succeeded += partial.succeeded
        aggregate.total += partial.total
      }

      return aggregate
    },
    id,
    slot: 'extract',
  }
}
