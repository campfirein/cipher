/**
 * Write node — service-bound (delegates to `services.write` which wraps
 * the existing curate-tool `executeCurate`).
 *
 * Phase 1: pure adapter. The curate-tool itself is NOT modified —
 * write-node just shapes its `applied[]` + `summary` output back into
 * the slot's output contract.
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {writeInputSchema, writeOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

export type WriteInput = z.infer<typeof writeInputSchema>
export type WriteOutput = z.infer<typeof writeOutputSchema>

const EMPTY_SUMMARY = {
  added: 0,
  deleted: 0,
  failed: 0,
  merged: 0,
  updated: 0,
} as const

export function createWriteNode(id = 'write'): CurationNode<WriteInput, WriteOutput> {
  return {
    async execute(input: WriteInput, ctx: NodeContext): Promise<WriteOutput> {
      if (input.decisions.length === 0) {
        return {applied: [], summary: {...EMPTY_SUMMARY}}
      }

      if (!ctx.services?.write) {
        throw new Error('write node requires ctx.services.write — no write service provided')
      }

      return ctx.services.write(input.decisions)
    },
    id,
    slot: 'write',
  }
}
