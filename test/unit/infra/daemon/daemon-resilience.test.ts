import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import {DaemonResilience} from '../../../../src/server/infra/daemon/daemon-resilience.js'

describe('daemon-resilience', () => {
  let sandbox: SinonSandbox
  let crashLogStub: SinonStub
  let logStub: SinonStub
  let onWakeStub: SinonStub

  beforeEach(() => {
    sandbox = createSandbox()
    crashLogStub = sandbox.stub().returns('/fake/log/path')
    logStub = sandbox.stub()
    onWakeStub = sandbox.stub()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('install()', () => {
    it('should register uncaughtException handler', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      const countBefore = process.listenerCount('uncaughtException')
      resilience.install()
      expect(process.listenerCount('uncaughtException')).to.equal(countBefore + 1)
      resilience.uninstall()
    })

    it('should register unhandledRejection handler', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      const countBefore = process.listenerCount('unhandledRejection')
      resilience.install()
      expect(process.listenerCount('unhandledRejection')).to.equal(countBefore + 1)
      resilience.uninstall()
    })

    it('should register SIGHUP handler', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      const countBefore = process.listenerCount('SIGHUP')
      resilience.install()
      expect(process.listenerCount('SIGHUP')).to.equal(countBefore + 1)
      resilience.uninstall()
    })

    it('should not double-install', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      const countBefore = process.listenerCount('uncaughtException')
      resilience.install()
      resilience.install() // second install should be no-op

      expect(process.listenerCount('uncaughtException')).to.equal(countBefore + 1)
      resilience.uninstall()
    })

    it('should log installation', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      resilience.install()
      expect(logStub.getCalls().some((c) => String(c.args[0]).includes('installed'))).to.be.true
      resilience.uninstall()
    })
  })

  describe('SIGHUP handling', () => {
    it('should not crash on SIGHUP', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      resilience.install()
      try {
        // Emitting SIGHUP should not crash
        expect(() => process.emit('SIGHUP')).to.not.throw()
      } finally {
        resilience.uninstall()
      }
    })
  })

  describe('sleep/wake detection', () => {
    it('should call onWake when time gap exceeds threshold', () => {
      const clock = sandbox.useFakeTimers(Date.now())

      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
        sleepWakeCheckIntervalMs: 50,
      })

      resilience.install()

      // First check fires normally — no wake
      clock.tick(50)
      expect(onWakeStub.called).to.be.false

      // Simulate sleep: jump Date.now 30s ahead without firing timers
      clock.setSystemTime(Date.now() + 30_000)

      // Next check fires and detects time gap → onWake
      clock.tick(50)
      expect(onWakeStub.calledOnce).to.be.true

      resilience.uninstall()
    })

    it('should not fire onWake during normal operation', () => {
      const clock = sandbox.useFakeTimers(Date.now())

      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
        sleepWakeCheckIntervalMs: 50,
      })

      resilience.install()

      // Advance through several check intervals — all normal
      clock.tick(200)
      expect(onWakeStub.called).to.be.false

      resilience.uninstall()
    })
  })

  describe('uninstall()', () => {
    it('should remove all handlers', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      const uncaughtBefore = process.listenerCount('uncaughtException')
      const rejectionBefore = process.listenerCount('unhandledRejection')
      const sighupBefore = process.listenerCount('SIGHUP')

      resilience.install()
      resilience.uninstall()

      expect(process.listenerCount('uncaughtException')).to.equal(uncaughtBefore)
      expect(process.listenerCount('unhandledRejection')).to.equal(rejectionBefore)
      expect(process.listenerCount('SIGHUP')).to.equal(sighupBefore)
    })

    it('should be idempotent', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      resilience.install()
      resilience.uninstall()
      expect(() => resilience.uninstall()).to.not.throw()
    })

    it('should log uninstallation', () => {
      const resilience = new DaemonResilience({
        crashLog: crashLogStub,
        log: logStub,
        onWake: onWakeStub,
      })

      resilience.install()
      resilience.uninstall()
      expect(logStub.getCalls().some((c) => String(c.args[0]).includes('uninstalled'))).to.be.true
    })
  })
})
