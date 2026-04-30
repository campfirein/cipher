import {expect} from 'chai'

import type {ChannelAgentDriver, PromptInput} from '../../../../../src/server/infra/channel/drivers/types.js'

import {CancelCoordinator} from '../../../../../src/server/infra/channel/drivers/cancel-coordinator.js'

class FakeDriver implements ChannelAgentDriver {
  public closed = 0
  /** Simulates an ACP server that ignores soft cancel — coordinator must escalate. */
  public ignoreSoftCancel = false
  public requested = 0

  public async forceClose(): Promise<void> {
    this.closed++
  }

  public async *prompt(_input: PromptInput): AsyncIterable<never> {
    /* unused in cancel tests */
  }

  public async requestCancel(): Promise<void> {
    this.requested++
  }
}

describe('CancelCoordinator', () => {
  it('bind/unbind tracks driver references', () => {
    const coord = new CancelCoordinator()
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver)
    expect(coord.size()).to.equal(1)
    coord.unbind('ch-1', 't-1')
    expect(coord.size()).to.equal(0)
  })

  it('cancelByTurnId calls requestCancel on the bound driver and reports cancelled:true', async () => {
    const coord = new CancelCoordinator({softCancelGraceMs: 5})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    const result = await coord.cancelByTurnId('ch-1', 't-1')
    expect(driver.requested).to.equal(1)
    expect(result).to.deep.equal({cancelled: true})
  })

  it('escalates to forceClose only if the turn is still active after the grace window', async () => {
    const coord = new CancelCoordinator({softCancelGraceMs: 20})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    await coord.cancelByTurnId('ch-1', 't-1')
    expect(driver.requested).to.equal(1)
    expect(driver.closed).to.equal(1)
  })

  it('does not escalate to forceClose if the turn unbinds during the grace window', async () => {
    const coord = new CancelCoordinator({softCancelGraceMs: 30})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    setTimeout(() => coord.unbind('ch-1', 't-1'), 5)
    const result = await coord.cancelByTurnId('ch-1', 't-1')
    expect(driver.requested).to.equal(1)
    expect(driver.closed).to.equal(0)
    expect(result).to.deep.equal({cancelled: true})
  })

  it('cancelByTurnId for an unknown turn returns cancelled:false', async () => {
    const coord = new CancelCoordinator()
    const result = await coord.cancelByTurnId('ch-1', 'nonexistent')
    expect(result).to.deep.equal({cancelled: false})
  })

  it('is idempotent — second cancel does not double-invoke', async () => {
    const coord = new CancelCoordinator({softCancelGraceMs: 5})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    await coord.cancelByTurnId('ch-1', 't-1')
    coord.unbind('ch-1', 't-1')
    await coord.cancelByTurnId('ch-1', 't-1')
    expect(driver.requested).to.equal(1)
    expect(driver.closed).to.equal(1)
  })

  it('no-recursion contract: requestCancel and forceClose are each called at most once per cancel', async () => {
    const coord = new CancelCoordinator({softCancelGraceMs: 10})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    await coord.cancelByTurnId('ch-1', 't-1')
    expect(driver.requested).to.equal(1)
    expect(driver.closed).to.equal(1)
  })

  // Codex F5 — after hard close, the pool entry must be evicted so the next turn gets a fresh driver.
  it('evicts the driver from the pool after hard close so the next turn gets a fresh driver', async () => {
    const evictions: Array<{agentId: string; channelId: string}> = []
    const fakePool = {
      async closeAll() { /* unused */ },
      async closeChannel() { /* unused */ },
      evict: (channelId: string, agentId: string) => evictions.push({agentId, channelId}),
      getOrCreate() { throw new Error('unused') },
    }
    const coord = new CancelCoordinator({driverPool: fakePool as never, softCancelGraceMs: 10})
    const driver = new FakeDriver()
    coord.bind('ch-1', 't-1', driver, 'agent-a')
    await coord.cancelByTurnId('ch-1', 't-1')
    expect(evictions).to.deep.equal([{agentId: 'agent-a', channelId: 'ch-1'}])
  })
})
