/**
 * Slot contract — the typed interface a curate-flow node must satisfy.
 *
 * Phase 1 ships descriptive contracts only: schemas document the I/O shape
 * but are NOT yet enforced at slot boundaries (the runner just calls
 * `node.execute(input)` directly). Phase 2 introduces the per-slot vm
 * sandbox that validates input/output against the schemas, enforces the
 * tool allowlist, and applies the timeout.
 *
 * The `defaultImpl` field is intentionally absent in Phase 1 — the
 * `slotContracts` registry exposes contracts only. Default implementations
 * live alongside as `nodes/{slot}-node.ts` (added in Task 1.6) and are
 * wired together by `dag-builder.ts` (added in Task 1.7).
 */

import type {z} from 'zod'

import type {NodeSlot} from '../types.js'

export interface SlotContract<In = unknown, Out = unknown> {
  readonly inputSchema: z.ZodType<In>
  readonly outputSchema: z.ZodType<Out>
  readonly slot: NodeSlot
  readonly timeoutMs: number
  /**
   * Per-slot tool allowlist. Empty = pure-JS slot (no `tools.*` access).
   * Phase 2 enforces this at the sandbox boundary.
   */
  readonly toolAllowlist: ReadonlyArray<string>
}
