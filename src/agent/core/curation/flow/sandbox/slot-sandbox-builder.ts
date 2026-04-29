/**
 * Per-slot sandbox builder.
 *
 * Phase 2 implementation uses **plain JS wrappers** (no `node:vm`) per
 * Phase 2 plan §11 finding F2: no untrusted code runs inside in Phase 2,
 * so VM overhead (~10ms/slot × 7 slots) is unjustified. The interface is
 * identical to a future VM-based variant — Phase 3 swaps the body when
 * agent-supplied JS code starts running here.
 *
 * Two boundaries enforced today:
 *   1. **Tool allowlist** — `tools` is a Proxy that throws
 *      `ToolAccessViolation` for any dotted key not in
 *      `slotContracts[slot].toolAllowlist`.
 *   2. **Per-slot timeout** — `runInSlot` races the user fn against
 *      `setTimeout(timeoutMs)` via an AbortController; on timeout the
 *      shared `signal` fires (so cooperative fns can bail out) and
 *      `runInSlot` rejects with `NodeTimeoutError`.
 *
 * `parentSignal` lets the caller plumb an externally-provided
 * AbortSignal (e.g., `NodeContext.signal`) — when the parent aborts, the
 * slot's internal signal aborts too, resolving CODE-REVIEW finding #7.
 *
 * ### Known limit — sync-code timeout escape
 *
 * Plain JS `setTimeout`+`Promise.race` cannot preempt synchronous code:
 * a busy loop holds the event loop and the abort timer can't fire until
 * the loop yields. This means a node containing `while (Date.now() < end) {}`
 * will run to completion past `timeoutMs` and resolve normally.
 *
 * Why this is acceptable in Phase 2:
 *   - All Phase 2 default nodes are async and call `ctx.services.*`,
 *     each of which awaits an LLM round-trip — they yield to the event
 *     loop, so the timer fires on time.
 *   - Default node code is *trusted code we wrote*, not agent-supplied
 *     untrusted JS. The threat model assumes default nodes don't
 *     deliberately busy-loop.
 *
 * Phase 3 fix: swap the body to `vm.runInContext({timeout: timeoutMs})`,
 * which interrupts execution mid-instruction. That swap is also when
 * untrusted agent-supplied JS first runs inside, which is exactly when
 * sync-code timeout enforcement starts mattering. See
 * `slot-sandbox-builder.test.ts` "documents Phase 2 sync-code timeout
 * escape" for a regression that pins the current behavior.
 */

import type {NodeSlot} from '../types.js'

import {slotContracts} from '../slots/contracts.js'
import {NodeTimeoutError, ToolAccessViolation} from './errors.js'

export {NodeTimeoutError, ToolAccessViolation} from './errors.js'

export interface SlotSandboxRunArgs {
  readonly signal: AbortSignal
  readonly tools: Record<string, unknown>
}

export interface SlotSandbox {
  runInSlot<T>(fn: (args: SlotSandboxRunArgs) => Promise<T>): Promise<T>
  readonly slot: NodeSlot
}

export interface SlotSandboxOptions {
  /** Externally-provided abort signal (e.g., `NodeContext.signal`). */
  readonly parentSignal?: AbortSignal
  /** Override `slotContracts[slot].timeoutMs` (tests + bench). */
  readonly timeoutMsOverride?: number
}

export function buildSlotSandbox(
  slot: NodeSlot,
  tools: Record<string, unknown>,
  options: SlotSandboxOptions = {},
): SlotSandbox {
  const contract = slotContracts[slot]
  // Allowlist entries are written as `tools.<path>` (the dotted form an
  // agent-authored slot would type). The proxy traverses the bare `tools`
  // object, so strip the leading `tools.` prefix here once.
  const allowlist = new Set(
    contract.toolAllowlist.map((entry) => (entry.startsWith('tools.') ? entry.slice(6) : entry)),
  )
  const timeoutMs = options.timeoutMsOverride ?? contract.timeoutMs

  const allowedTools = buildAllowedToolsProxy(slot, tools, allowlist)

  return {
    async runInSlot<T>(fn: (args: SlotSandboxRunArgs) => Promise<T>): Promise<T> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      // Link parent signal: when parent aborts, our controller also aborts.
      const parent = options.parentSignal
      const onParentAbort = (): void => {
        controller.abort()
      }

      if (parent) {
        if (parent.aborted) {
          controller.abort()
        } else {
          parent.addEventListener('abort', onParentAbort, {once: true})
        }
      }

      try {
        const fnPromise = fn({signal: controller.signal, tools: allowedTools})
        const timeoutPromise = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new NodeTimeoutError(slot, timeoutMs)),
            {once: true},
          )
        })

        return await Promise.race([fnPromise, timeoutPromise])
      } finally {
        clearTimeout(timer)
        parent?.removeEventListener('abort', onParentAbort)
      }
    },
    slot,
  }
}

function buildAllowedToolsProxy(
  slot: NodeSlot,
  tools: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
): Record<string, unknown> {
  return new Proxy(tools, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }

      const value = Reflect.get(target, prop, receiver)
      return wrapWithGuard(slot, allowlist, prop, value)
    },
  })
}

function wrapWithGuard(
  slot: NodeSlot,
  allowlist: ReadonlySet<string>,
  pathSoFar: string,
  value: unknown,
): unknown {
  if (typeof value === 'function') {
    if (!allowlist.has(pathSoFar)) {
      // Returning a thrower (rather than throwing on get) keeps the
      // Proxy's `get` trap free of side effects and lets call sites
      // see the violation at invocation time. Surface the violation
      // with the dotted `tools.` form (matching the allowlist syntax).
      return () => {
        throw new ToolAccessViolation(slot, `tools.${pathSoFar}`)
      }
    }

    return value
  }

  if (value !== null && typeof value === 'object') {
    return new Proxy(value as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver)
        }

        const child = Reflect.get(target, prop, receiver)
        return wrapWithGuard(slot, allowlist, `${pathSoFar}.${prop}`, child)
      },
    })
  }

  return value
}
