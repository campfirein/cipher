/**
 * Sandbox boundary errors for the curate-flow runtime.
 *
 * Each error carries the offending slot name so callers can route
 * failures into per-slot recording without re-parsing message text.
 *
 * Phase 2 introduces these via plain JS wrappers; Phase 3 reuses the
 * exact same types when promoting to the `node:vm` sandbox so the
 * pause-on-failure protocol can switch on `error instanceof X`.
 */

import type {NodeSlot} from '../types.js'

export class ToolAccessViolation extends Error {
  public readonly slot: NodeSlot
  public readonly toolPath: string

  constructor(slot: NodeSlot, toolPath: string) {
    super(`slot '${slot}' is not allowed to access tool '${toolPath}' (not in toolAllowlist)`)
    this.name = 'ToolAccessViolation'
    this.slot = slot
    this.toolPath = toolPath
  }
}

export class NodeTimeoutError extends Error {
  public readonly slot: NodeSlot
  public readonly timeoutMs: number

  constructor(slot: NodeSlot, timeoutMs: number) {
    super(`slot '${slot}' exceeded its ${timeoutMs}ms timeout and was aborted`)
    this.name = 'NodeTimeoutError'
    this.slot = slot
    this.timeoutMs = timeoutMs
  }
}

export class SchemaValidationError extends Error {
  public readonly issues: ReadonlyArray<{message: string; path: ReadonlyArray<number | string>}>
  public readonly phase: 'input' | 'output'
  public readonly slot: NodeSlot

  constructor(
    slot: NodeSlot,
    phase: 'input' | 'output',
    issues: ReadonlyArray<{message: string; path: ReadonlyArray<number | string>}>,
  ) {
    const issueSummary = issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    super(`slot '${slot}' ${phase} schema validation failed: ${issueSummary}`)
    this.name = 'SchemaValidationError'
    this.slot = slot
    this.phase = phase
    this.issues = issues
  }
}
