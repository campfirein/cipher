import type {IAcpDriver} from '../../../core/interfaces/channel/i-acp-driver.js'

import {ParleyResponseError} from './parley-response-generator.js'

/**
 * Phase 9 / Slice 9.4f — profile-keyed warm driver pool for the
 * Bob-side parley dispatcher.
 *
 * Replaces the per-query subprocess spawn shipped in 9.4c
 * (`local-agent-response-generator.ts` TODO + kimi round-1 LOW-C). One
 * `IAcpDriver` (i.e. one ACP subprocess) is kept warm per profile name
 * and reused across inbound parley queries. A hard cap on the number
 * of in-flight drivers per profile prevents resource exhaustion under
 * concurrent inbound traffic: when the cap is reached, `acquire()`
 * throws `PARLEY_LOCAL_AGENT_BUSY` so the parley-server projects it
 * as a signed `error` terminal frame back to the dialer (fail-fast,
 * no head-of-line blocking).
 *
 * The pool does NOT start a driver eagerly — drivers spawn lazily on
 * the first `acquire()` for a profile that has an idle slot. Drivers
 * that fail `start()` do NOT consume a slot (the reservation is
 * rolled back so the next acquire can retry).
 */

export type BridgeDriverPoolDeps = {
  /**
   * Hard cap on concurrent in-flight drivers per profile. The
   * (size-1)+ case keeps `maxPerProfile` warm drivers around in
   * total per profile; under steady-state load the pool reuses them
   * without spawn cost.
   */
  readonly maxPerProfile: number
}

export type DriverFactory = () => IAcpDriver

export type AcquiredDriver = {
  readonly driver: IAcpDriver
  /**
   * Mark the driver idle so the next `acquire()` for the same
   * profile can reuse it. Idempotent: repeated calls are a no-op.
   */
  release(): void
}

export class BridgeDriverPool {
  private readonly idleSlots = new Map<string, IAcpDriver[]>()
  private readonly maxPerProfile: number
  private readonly slots = new Map<string, IAcpDriver[]>()
  private readonly startingCount = new Map<string, number>()

  public constructor(deps: BridgeDriverPoolDeps) {
    if (deps.maxPerProfile < 1) {
      throw new Error(`BridgeDriverPool: maxPerProfile must be >= 1; got ${deps.maxPerProfile}`)
    }

    this.maxPerProfile = deps.maxPerProfile
  }

  /**
   * Acquire an idle driver for the profile, spawning a new one if
   * the cap allows. Throws `PARLEY_LOCAL_AGENT_BUSY` when the per-
   * profile cap is reached.
   */
  public async acquire(profileName: string, factory: DriverFactory): Promise<AcquiredDriver> {
    // Synchronous prelude — runs to completion before any await, so
    // concurrent acquires can't race past the cap check.
    const idle = this.idleSlots.get(profileName)
    if (idle !== undefined && idle.length > 0) {
      const driver = idle.pop()!
      return this.wrap(profileName, driver)
    }

    const liveSlots = this.slots.get(profileName)?.length ?? 0
    const pendingStarts = this.startingCount.get(profileName) ?? 0
    if (liveSlots + pendingStarts >= this.maxPerProfile) {
      throw new ParleyResponseError(
        'PARLEY_LOCAL_AGENT_BUSY',
        `bridge driver pool exhausted for profile (cap=${this.maxPerProfile} reached)`,
      )
    }

    this.startingCount.set(profileName, pendingStarts + 1)

    // From here on the slot is reserved. Roll it back on any failure
    // so a flaky start() doesn't permanently shrink the pool.
    try {
      const driver = factory()
      await driver.start()
      const list = this.slots.get(profileName) ?? []
      list.push(driver)
      this.slots.set(profileName, list)
      return this.wrap(profileName, driver)
    } finally {
      this.startingCount.set(profileName, (this.startingCount.get(profileName) ?? 1) - 1)
    }
  }

  /**
   * Daemon shutdown hook — stop every warm driver and forget the
   * pool. Errors from `driver.stop()` are swallowed so a single
   * misbehaving subprocess does not block daemon shutdown.
   */
  public async closeAll(): Promise<void> {
    const all: Promise<void>[] = []
    for (const list of this.slots.values()) {
      for (const d of list) {
        all.push(d.stop().catch(() => {}))
      }
    }

    this.slots.clear()
    this.idleSlots.clear()
    await Promise.all(all)
  }

  private wrap(profileName: string, driver: IAcpDriver): AcquiredDriver {
    let released = false
    return {
      driver,
      release: () => {
        if (released) return
        released = true
        const idle = this.idleSlots.get(profileName) ?? []
        idle.push(driver)
        this.idleSlots.set(profileName, idle)
      },
    }
  }
}
