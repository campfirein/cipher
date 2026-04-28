/**
 * Phase 2 Task 2.1 — slot sandbox builder.
 *
 * Per Phase 2 plan §11 finding F2: Phase 2 uses plain JS wrappers (no
 * `node:vm`) for the sandbox boundary. The interface stays identical
 * to the eventual VM-based variant so Phase 3 can swap implementations
 * when actual untrusted agent code starts running inside.
 *
 * What this test asserts:
 *   - `buildSlotSandbox(slot, tools)` returns a handle with `runInSlot`.
 *   - `tools.*` accessor only exposes keys in `slotContracts[slot].toolAllowlist`.
 *   - Calling an outside-allowlist tool throws `ToolAccessViolation`.
 *   - `runInSlot` returns the function's resolved value when it completes
 *     within `slotContracts[slot].timeoutMs`.
 *   - A function exceeding the timeout is aborted via `AbortController` and
 *     `runInSlot` throws `NodeTimeoutError`.
 *   - The per-slot AbortSignal is exposed to the function so it can opt
 *     into early cancellation.
 */

import {expect} from 'chai'

import {
  buildSlotSandbox,
  NodeTimeoutError,
  ToolAccessViolation,
} from '../../../../../src/agent/core/curation/flow/sandbox/slot-sandbox-builder.js'
import {delay} from '../../../../helpers/delay.js'

// Minimal stub tools mirror the real ToolsSDK shape: a nested object with
// the dotted keys from `toolAllowlist`.
function makeStubTools(): Record<string, unknown> {
  return {
    curate: () => 'curate-result',
    curation: {
      conflict: () => 'conflict-result',
      mapExtract: () => 'extract-result',
      recon: () => 'recon-result',
    },
  }
}

describe('buildSlotSandbox', () => {
  describe('tool allowlist enforcement', () => {
    it('exposes ONLY tools in the slot allowlist (extract → mapExtract only)', async () => {
      const sandbox = buildSlotSandbox('extract', makeStubTools())

      const result = await sandbox.runInSlot(async ({tools}) => {
        // mapExtract is in extract's allowlist (`tools.curation.mapExtract`)
        const extracted = (tools as {curation: {mapExtract: () => string}}).curation.mapExtract()
        return extracted
      })

      expect(result).to.equal('extract-result')
    })

    it('throws ToolAccessViolation when accessing a tool outside the allowlist', async () => {
      const sandbox = buildSlotSandbox('extract', makeStubTools())

      let thrown: Error | undefined
      try {
        await sandbox.runInSlot(async ({tools}) => {
          // tools.curate is in `write` allowlist, NOT `extract`.
          ;(tools as {curate: () => string}).curate()
          return 'should-not-reach'
        })
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).to.be.instanceOf(ToolAccessViolation)
      expect(thrown?.message).to.match(/extract|allowlist|curate/i)
    })

    it('write slot exposes tools.curate (allowlist match)', async () => {
      const sandbox = buildSlotSandbox('write', makeStubTools())

      const result = await sandbox.runInSlot(async ({tools}) => (tools as {curate: () => string}).curate())

      expect(result).to.equal('curate-result')
    })

    it('pure-JS slot (chunk, dedup, group) has empty tools — any access throws', async () => {
      const sandbox = buildSlotSandbox('chunk', makeStubTools())

      let thrown: Error | undefined
      try {
        await sandbox.runInSlot(async ({tools}) => {
          ;(tools as {curate: () => string}).curate()
          return 'nope'
        })
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).to.be.instanceOf(ToolAccessViolation)
    })
  })

  describe('per-slot timeout enforcement', () => {
    it('returns the function value when it completes within timeoutMs', async () => {
      // chunk timeoutMs = 5000; quick fn finishes well within that.
      const sandbox = buildSlotSandbox('chunk', makeStubTools())
      const result = await sandbox.runInSlot(async () => 'ok')
      expect(result).to.equal('ok')
    })

    it('aborts and throws NodeTimeoutError when fn exceeds timeoutMs', async () => {
      // Use a shorter override so the test runs fast. Slot itself stays 'chunk'.
      const sandbox = buildSlotSandbox('chunk', makeStubTools(), {timeoutMsOverride: 50})

      let thrown: Error | undefined
      try {
        await sandbox.runInSlot(async ({signal}) => {
          await delay(500, signal)
          return 'should-not-reach'
        })
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).to.be.instanceOf(NodeTimeoutError)
      expect(thrown?.message).to.match(/chunk|timeout|50/i)
    })

    it('exposes signal to the function for cooperative cancellation', async () => {
      const sandbox = buildSlotSandbox('chunk', makeStubTools(), {timeoutMsOverride: 30})

      let signalSeen: AbortSignal | undefined
      try {
        await sandbox.runInSlot(async ({signal}) => {
          signalSeen = signal
          await delay(500, signal)
        })
      } catch {
        // expected timeout
      }

      expect(signalSeen).to.exist
      expect(signalSeen?.aborted).to.be.true
    })
  })

  describe('known limit — sync-code escapes timeout (Phase 2 design gap)', () => {
    // This test PINS the documented limit so future readers see it's
    // intentional. The Phase 2 sandbox is plain JS (not `node:vm`), so
    // setTimeout + Promise.race cannot preempt synchronous code that
    // hogs the event loop. Phase 3 swaps to `vm.runInContext({timeout})`
    // which interrupts mid-instruction; that's also when untrusted
    // agent-supplied JS first runs inside the sandbox, so the gap
    // closes exactly when it starts mattering.
    //
    // See slot-sandbox-builder.ts "Known limit" docstring + plan §11
    // finding F2 + PHASE-2-CODE-REVIEW E2/P1.
    it('a sync busy loop runs to completion past timeoutMs (NOT aborted)', async () => {
      const sandbox = buildSlotSandbox('chunk', {}, {timeoutMsOverride: 10})

      const result = await sandbox.runInSlot(async () => {
        // Sync busy loop: blocks the event loop, so the abort timer
        // (scheduled for +10ms) cannot fire until this returns.
        const end = Date.now() + 60
        while (Date.now() < end) {
          // intentional busy-wait
        }

        return 'sync-completed'
      })

      // The fn resolves normally; NodeTimeoutError is NOT thrown.
      // This is the documented Phase 2 limitation — Phase 3 fixes it.
      expect(result).to.equal('sync-completed')
    })
  })

  describe('linkedSignal composition', () => {
    it('aborts when an externally-provided parent signal aborts (before timeout)', async () => {
      const parent = new AbortController()
      const sandbox = buildSlotSandbox('chunk', makeStubTools(), {
        parentSignal: parent.signal,
        timeoutMsOverride: 5000,
      })

      // Abort the parent shortly after starting.
      setTimeout(() => parent.abort(), 30)

      let thrown: Error | undefined
      try {
        await sandbox.runInSlot(async ({signal}) => {
          await delay(2000, signal)
          return 'should-not-reach'
        })
      } catch (error) {
        thrown = error as Error
      }

      // Parent abort propagates through; the slot signal observes it.
      expect(thrown).to.exist
      expect(thrown?.message).to.match(/abort|cancel|timeout/i)
    })
  })

  describe('errors carry slot identity', () => {
    it('ToolAccessViolation includes the slot name', async () => {
      const sandbox = buildSlotSandbox('dedup', makeStubTools())

      let thrown: ToolAccessViolation | undefined
      try {
        await sandbox.runInSlot(async ({tools}) => {
          ;(tools as {curate: () => string}).curate()
          return ''
        })
      } catch (error) {
        thrown = error as ToolAccessViolation
      }

      expect(thrown).to.exist
      expect(thrown?.slot).to.equal('dedup')
    })

    it('NodeTimeoutError includes the slot name and effective timeout', async () => {
      const sandbox = buildSlotSandbox('chunk', makeStubTools(), {timeoutMsOverride: 25})

      let thrown: NodeTimeoutError | undefined
      try {
        await sandbox.runInSlot(async ({signal}) => {
          await delay(500, signal)
        })
      } catch (error) {
        thrown = error as NodeTimeoutError
      }

      expect(thrown).to.exist
      expect(thrown?.slot).to.equal('chunk')
      expect(thrown?.timeoutMs).to.equal(25)
    })
  })
})
