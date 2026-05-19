/* eslint-disable unicorn/consistent-function-scoping */
// Factory closures live inline for test readability; hoisting them
// to module scope would obscure their per-case state (FakeDriver
// instances, useGood/useNew toggles).

import {expect} from 'chai'

import type {AcpDriverPromptArgs, IAcpDriver, TurnEventPayload} from '../../../../../../src/server/core/interfaces/channel/i-acp-driver.js'

import {BridgeDriverPool} from '../../../../../../src/server/infra/channel/bridge/bridge-driver-pool.js'
import {ParleyResponseError} from '../../../../../../src/server/infra/channel/bridge/parley-response-generator.js'

// Phase 9 / Slice 9.4f — profile-keyed warm driver pool + concurrency
// cap. Replaces the per-query subprocess spawn from 9.4c (kimi LOW-C).

class FakeDriver implements IAcpDriver {
  public acpInitialize = undefined
  public capabilities: string[] = []
  public handle = '@fake'
  public protocolVersion: number | undefined = 1
  public startCalls = 0
  public startShouldThrow: boolean = false
  public status: 'errored' | 'idle' | 'stopped' | 'streaming' = 'idle'
  public stopCalls = 0

  async cancel(): Promise<void> {}

  async probeSession(): Promise<boolean> { return true }

  async *prompt(_args: AcpDriverPromptArgs): AsyncIterableIterator<TurnEventPayload> { /* empty */ }

  async respondToPermission(): Promise<void> {}

  async start(): Promise<void> {
    this.startCalls += 1
    if (this.startShouldThrow) {
      this.status = 'errored'
      throw new Error('boom')
    }

    this.status = 'idle'
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
    this.status = 'stopped'
  }
}

describe('BridgeDriverPool (slice 9.4f)', () => {
  describe('warm reuse', () => {
    it('returns the same driver after release on the next acquire (no second start)', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 2})
      const driver = new FakeDriver()
      const factory = () => driver

      const a = await pool.acquire('profile-a', factory)
      expect(driver.startCalls).to.equal(1)
      a.release()

      const b = await pool.acquire('profile-a', factory)
      expect(b.driver).to.equal(driver)
      expect(driver.startCalls).to.equal(1)
    })
  })

  describe('concurrency cap', () => {
    it('spawns distinct drivers up to maxPerProfile', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 2})
      const drivers = [new FakeDriver(), new FakeDriver()]
      let i = 0
      const factory = () => drivers[i++]

      const a = await pool.acquire('p', factory)
      const b = await pool.acquire('p', factory)
      expect(a.driver).to.not.equal(b.driver)
      expect(drivers[0].startCalls).to.equal(1)
      expect(drivers[1].startCalls).to.equal(1)
    })

    it('throws PARLEY_LOCAL_AGENT_BUSY when cap is reached', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 1})
      const factory = () => new FakeDriver()
      await pool.acquire('p', factory)
      try {
        await pool.acquire('p', factory)
        expect.fail('expected PARLEY_LOCAL_AGENT_BUSY')
      } catch (error) {
        expect(error).to.be.instanceOf(ParleyResponseError)
        expect((error as ParleyResponseError).code).to.equal('PARLEY_LOCAL_AGENT_BUSY')
      }
    })

    it('caps are scoped per profile (busy on one does not affect the other)', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 1})
      const factory = () => new FakeDriver()
      await pool.acquire('profile-a', factory)
      // profile-b still has its own free slot
      const b = await pool.acquire('profile-b', factory)
      expect(b.driver).to.exist
    })
  })

  describe('start() failures', () => {
    it('does not consume a slot when driver.start() throws', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 1})
      const bad = new FakeDriver()
      bad.startShouldThrow = true
      const good = new FakeDriver()
      let useGood = false
      const factory = () => (useGood ? good : bad)

      try {
        await pool.acquire('p', factory)
        expect.fail('expected start() to throw')
      } catch {
        // expected
      }

      // Slot is free again — next acquire should succeed.
      useGood = true
      const acquired = await pool.acquire('p', factory)
      expect(acquired.driver).to.equal(good)
    })
  })

  describe('idempotent release', () => {
    it('calling release() twice does not put the driver into the idle pool twice', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 2})
      const driver = new FakeDriver()
      const factory = () => driver

      const a = await pool.acquire('p', factory)
      a.release()
      a.release()  // second call is a no-op

      // If the second release double-counted, acquire would still
      // give us THIS driver. Acquire two more times and check they're
      // distinct.
      const more = new FakeDriver()
      let useNew = false
      const factory2 = () => (useNew ? more : driver)

      const b = await pool.acquire('p', factory2)
      expect(b.driver).to.equal(driver)
      useNew = true
      const c = await pool.acquire('p', factory2)
      expect(c.driver).to.equal(more)
    })
  })

  describe('closeAll', () => {
    it('stops every started driver and forgets the pool', async () => {
      const pool = new BridgeDriverPool({maxPerProfile: 3})
      const d1 = new FakeDriver()
      const d2 = new FakeDriver()
      const d3 = new FakeDriver()
      let i = 0
      const factory = () => [d1, d2, d3][i++]

      const a = await pool.acquire('p1', factory)
      const b = await pool.acquire('p1', factory)
      const c = await pool.acquire('p2', factory)
      a.release()
      b.release()
      c.release()

      await pool.closeAll()
      expect(d1.stopCalls).to.equal(1)
      expect(d2.stopCalls).to.equal(1)
      expect(d3.stopCalls).to.equal(1)

      // After closeAll, pool is empty — next acquire spawns fresh.
      const d4 = new FakeDriver()
      const acquired = await pool.acquire('p1', () => d4)
      expect(acquired.driver).to.equal(d4)
      expect(d4.startCalls).to.equal(1)
    })
  })
})
