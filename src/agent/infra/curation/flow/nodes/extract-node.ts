/**
 * Extract node — service-bound (LLM via `services.extract`).
 *
 * Phase 2 (Task 2.4) parallelizes per-chunk extraction via `pMap`. The
 * default DAG keeps ONE extract-node instance (the runner doesn't fan
 * out N nodes); concurrency happens INSIDE this node so the runner
 * remains agnostic of slot-specific tuning.
 *
 * Concurrency: `ctx.extractConcurrency ?? 4`. Real-LLM benchmarks (UAT
 * scenario 3) showed sequential ~6 min on 37 KB / ~10 chunks; the goal
 * is ~90–120s under concurrency 4. The bench harness in
 * `test/benchmarks/curate-flow.bench.ts` tracks this across commits.
 *
 * Aggregation: facts concatenated in pMap input order; counts summed.
 * Per-chunk failures bubble up as a thrown error from the underlying
 * service, which `pMap` propagates as a rejection — this surfaces as a
 * `NodeTimeoutError` if the slot's outer timeout fires, otherwise as
 * the original error which the runner records into `result.failures`.
 */

import type {z} from 'zod'

import pMap from 'p-map'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {extractInputSchema, extractOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

export type ExtractInput = z.infer<typeof extractInputSchema>
export type ExtractOutput = z.infer<typeof extractOutputSchema>

const DEFAULT_EXTRACT_CONCURRENCY = 4

export function createExtractNode(id = 'extract'): CurationNode<ExtractInput, ExtractOutput> {
  return {
    async execute(input: ExtractInput, ctx: NodeContext): Promise<ExtractOutput> {
      if (input.chunks.length === 0) {
        return {facts: [], failed: 0, succeeded: 0, total: 0}
      }

      const extract = ctx.services?.extract
      if (!extract) {
        throw new Error(
          'extract node requires ctx.services.extract — no extraction service provided',
        )
      }

      const concurrency = Math.max(1, ctx.extractConcurrency ?? DEFAULT_EXTRACT_CONCURRENCY)
      const partials = await pMap(
        input.chunks,
        (chunk) => extract(chunk, ctx.taskId),
        {concurrency},
      )

      const aggregate: ExtractOutput = {facts: [], failed: 0, succeeded: 0, total: 0}
      for (const partial of partials) {
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
