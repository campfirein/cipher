/**
 * Group node — pure JS, no LLM.
 *
 * Wraps `groupBySubject()` from src/agent/infra/sandbox/curation-helpers.ts.
 * Receives extract's output (uses `facts`, ignores extraction counts).
 * Buckets facts by subject (falling back to category, then 'uncategorized').
 */

import type {z} from 'zod'

import type {CurationNode, NodeContext} from '../../../../core/curation/flow/runner.js'
import type {groupInputSchema, groupOutputSchema} from '../../../../core/curation/flow/slots/schemas.js'

import {groupBySubject} from '../../../sandbox/curation-helpers.js'

export type GroupInput = z.infer<typeof groupInputSchema>
export type GroupOutput = z.infer<typeof groupOutputSchema>

export function createGroupNode(id = 'group'): CurationNode<GroupInput, GroupOutput> {
  return {
    async execute(input: GroupInput, _ctx: NodeContext): Promise<GroupOutput> {
      const grouped = groupBySubject(input.facts)
      return {grouped}
    },
    id,
    slot: 'group',
  }
}
