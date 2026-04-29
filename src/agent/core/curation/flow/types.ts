/**
 * Curate-flow type primitives.
 *
 * Phase 1 scaffold — see plan/agent-driven-graph/PHASE-1-IMPLEMENTATION.md.
 * Slot contracts (input/output schemas, tool allowlist, timeouts) live in
 * `./slots/`. The runner and node interfaces live in `./runner-types.ts`.
 */

export type NodeSlot =
  | 'chunk'
  | 'conflict'
  | 'dedup'
  | 'extract'
  | 'group'
  | 'recon'
  | 'write'

/**
 * Canonical execution order of the default curate DAG.
 *
 * Used by `dag-builder` to wire the default linear topology and by tests
 * to assert ordering. Future phases (positional insertion) will continue
 * to respect this order for the base slots; insertions land at named
 * extension points between adjacent base slots.
 */
export const NODE_SLOT_ORDER: ReadonlyArray<NodeSlot> = [
  'recon',
  'chunk',
  'extract',
  'group',
  'dedup',
  'conflict',
  'write',
] as const
