import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import {IdleTimeoutPolicy} from '../../../../src/server/infra/daemon/idle-timeout-policy.js'

describe('idle-timeout-policy', () => {
  let sandbox: SinonSandbox
  let clock: ReturnType<typeof sandbox.useFakeTimers>
  let onIdleStub: SinonStub
  let logStub: SinonStub

  beforeEach(() => {
    sandbox = createSandbox()
    clock = sandbox.useFakeTimers({now: Date.now()})
    onIdleStub = sandbox.stub()
    logStub = sandbox.stub()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should not fire onIdle while clients are connected', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()
    policy.onClientConnected()

    // Advance past timeout
    clock.tick(1000)

    expect(onIdleStub.called).to.be.false
    policy.stop()
  })

  it('should fire onIdle exactly at timeout with 0 clients', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()

    // Advance just before timeout — should not fire
    clock.tick(499)
    expect(onIdleStub.called).to.be.false

    // Advance to exactly timeout — should fire
    clock.tick(1)
    expect(onIdleStub.calledOnce).to.be.true
    policy.stop()
  })

  it('should reset timer when client connects then disconnects', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()

    // Advance partway through timeout
    clock.tick(400)

    // Client activity resets timer
    policy.onClientConnected()
    policy.onClientDisconnected()

    // Advance another 400ms (should not have reached 500ms since last activity)
    clock.tick(400)
    expect(onIdleStub.called).to.be.false

    // Now advance past the full timeout from last activity
    clock.tick(100)
    expect(onIdleStub.calledOnce).to.be.true
    policy.stop()
  })

  it('should not fire after stop', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()
    policy.stop()

    clock.tick(1000)
    expect(onIdleStub.called).to.be.false
  })

  it('should re-fire onIdle after full timeout if shutdown did not stop the policy', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub, // stub does nothing — simulates failed shutdown
      timeoutMs: 500,
    })

    policy.start()

    // First fire at exactly 500ms
    clock.tick(500)
    expect(onIdleStub.calledOnce).to.be.true

    // Safety net: should re-fire after timeoutMs
    clock.tick(500)
    expect(onIdleStub.calledTwice).to.be.true
    policy.stop()
  })

  it('should continue scheduling when onIdle throws', () => {
    const throwingOnIdle = sandbox.stub().throws(new Error('shutdown failed'))

    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: throwingOnIdle,
      timeoutMs: 500,
    })

    policy.start()

    // First fire — onIdle throws but should not kill the loop
    clock.tick(500)
    expect(throwingOnIdle.calledOnce).to.be.true
    expect(logStub.calledWith('onIdle callback failed: shutdown failed')).to.be.true

    // Safety net should still re-fire after timeoutMs
    clock.tick(500)
    expect(throwingOnIdle.calledTwice).to.be.true
    policy.stop()
  })

  it('should clamp client count to min 0', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()

    // Disconnect without prior connect — should not go negative
    policy.onClientDisconnected()
    policy.onClientDisconnected()

    // One connect should make it 1, not -1
    policy.onClientConnected()

    clock.tick(1000)

    // Should not fire idle — 1 client connected
    expect(onIdleStub.called).to.be.false
    policy.stop()
  })

  it('should cancel timer when client connects during idle countdown', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()

    // Advance partway — timer is counting down
    clock.tick(300)

    // Client connects — timer should be cancelled
    policy.onClientConnected()

    // Advance past original timeout — should NOT fire
    clock.tick(300)
    expect(onIdleStub.called).to.be.false

    policy.stop()
  })

  it('should report accurate idle status', () => {
    const policy = new IdleTimeoutPolicy({
      log: logStub,
      onIdle: onIdleStub,
      timeoutMs: 500,
    })

    policy.start()

    // No clients → should report idle status
    clock.tick(200)
    const status = policy.getIdleStatus()
    expect(status).to.not.be.undefined
    expect(status!.clientCount).to.equal(0)
    expect(status!.idleMs).to.equal(200)
    expect(status!.remainingMs).to.equal(300)

    // Client connects → no idle status
    policy.onClientConnected()
    expect(policy.getIdleStatus()).to.be.undefined

    policy.stop()
  })

})
