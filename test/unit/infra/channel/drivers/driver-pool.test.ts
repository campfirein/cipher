import {expect} from 'chai'

import type {ChannelAgentDriver, PromptInput} from '../../../../../src/server/infra/channel/drivers/types.js'

import {DriverPool} from '../../../../../src/server/infra/channel/drivers/driver-pool.js'

class FakeDriver implements ChannelAgentDriver {
  public closed = 0
  public closedFlag = false

  public async forceClose(): Promise<void> {
    this.closed++
    this.closedFlag = true
  }

  public isClosed(): boolean {
    return this.closedFlag
  }

  public async *prompt(_input: PromptInput): AsyncIterable<never> {
    /* not used in pool tests */
  }

  public async requestCancel(): Promise<void> {
    /* not used in pool tests */
  }
}

const fakeFactory = () => new FakeDriver()

describe('DriverPool', () => {
  it('getOrCreate returns the same instance for repeated (channelId, agentId)', () => {
    let calls = 0
    const pool = new DriverPool()
    const factory = () => {
      calls++
      return new FakeDriver()
    }

    const a = pool.getOrCreate('ch-1', 'claude-code', factory)
    const b = pool.getOrCreate('ch-1', 'claude-code', factory)
    expect(a).to.equal(b)
    expect(calls).to.equal(1)
  })

  it('different channels with the same agentId get different driver instances (Q8 isolation)', () => {
    const pool = new DriverPool()
    const a = pool.getOrCreate('ch-A', 'claude-code', fakeFactory)
    const b = pool.getOrCreate('ch-B', 'claude-code', fakeFactory)
    expect(a).to.not.equal(b)
  })

  it('different agents in the same channel get different instances', () => {
    const pool = new DriverPool()
    const a = pool.getOrCreate('ch-1', 'claude-code', fakeFactory)
    const b = pool.getOrCreate('ch-1', 'opencode', fakeFactory)
    expect(a).to.not.equal(b)
  })

  it('closeChannel forceCloses every driver tagged with that channel', async () => {
    const pool = new DriverPool()
    const a = new FakeDriver()
    const b = new FakeDriver()
    const c = new FakeDriver()
    pool.getOrCreate('ch-1', 'agent-a', () => a)
    pool.getOrCreate('ch-1', 'agent-b', () => b)
    pool.getOrCreate('ch-2', 'agent-a', () => c)
    await pool.closeChannel('ch-1')
    expect(a.closed).to.equal(1)
    expect(b.closed).to.equal(1)
    expect(c.closed).to.equal(0)  // unrelated channel, untouched
    // pool no longer caches the closed entries
    const a2 = pool.getOrCreate('ch-1', 'agent-a', () => new FakeDriver())
    expect(a2).to.not.equal(a)
  })

  it('closeAll forceCloses every cached driver', async () => {
    const pool = new DriverPool()
    const drivers = [new FakeDriver(), new FakeDriver(), new FakeDriver()]
    pool.getOrCreate('ch-1', 'agent-a', () => drivers[0])
    pool.getOrCreate('ch-1', 'agent-b', () => drivers[1])
    pool.getOrCreate('ch-2', 'agent-a', () => drivers[2])
    await pool.closeAll()
    for (const driver of drivers) expect(driver.closed).to.equal(1)
  })

  // Codex F5 — pool detects a closed driver and recreates on the next getOrCreate.
  it('recreates a driver if the cached one reports isClosed()', () => {
    const pool = new DriverPool()
    const first = pool.getOrCreate('ch-1', 'agent-a', fakeFactory) as FakeDriver
    first.closedFlag = true
    const second = pool.getOrCreate('ch-1', 'agent-a', fakeFactory)
    expect(second).to.not.equal(first)
  })

  it('evict(channelId, agentId) drops the cache entry without forceClosing', () => {
    const pool = new DriverPool()
    const driver = pool.getOrCreate('ch-1', 'agent-a', fakeFactory) as FakeDriver
    pool.evict('ch-1', 'agent-a')
    expect(driver.closed).to.equal(0) // evict alone does NOT close — coordinator already did
    const fresh = pool.getOrCreate('ch-1', 'agent-a', fakeFactory)
    expect(fresh).to.not.equal(driver)
  })

  it('lookup(channelId, turnId) is undefined unless explicitly bound — pool is not the cancel index', () => {
    const pool = new DriverPool()
    pool.getOrCreate('ch-1', 'agent-a', fakeFactory)
    // Pool API does not expose turnId-based lookup; that's CancelCoordinator's job.
    expect((pool as unknown as Record<string, unknown>).lookupByTurn).to.be.undefined
  })
})
