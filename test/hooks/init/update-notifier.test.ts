import {expect} from 'chai'
import * as sinon from 'sinon'

import type {NarrowedUpdateNotifier, UpdateNotifierDeps} from '../../../src/oclif/hooks/init/update-notifier.js'

import {handleUpdateNotification, isNpmGlobalInstall, UPDATE_CHECK_INTERVAL_MS} from '../../../src/oclif/hooks/init/update-notifier.js'

describe('update-notifier hook', () => {
  describe('UPDATE_CHECK_INTERVAL_MS', () => {
    it('should be 1 hour in milliseconds', () => {
      expect(UPDATE_CHECK_INTERVAL_MS).to.equal(1000 * 60 * 60)
    })
  })

  describe('handleUpdateNotification', () => {
    let confirmStub: sinon.SinonStub<[{default: boolean; message: string}], Promise<boolean>>
    let execSyncStub: sinon.SinonStub<[string, {stdio: 'inherit'}], void>
    let exitStub: sinon.SinonStub<[number], never>
    let logStub: sinon.SinonStub<[string], void>
    let notifyStub: sinon.SinonStub

    beforeEach(() => {
      confirmStub = sinon.stub()
      execSyncStub = sinon.stub()
      exitStub = sinon.stub<[number], never>()
      logStub = sinon.stub()
      notifyStub = sinon.stub()
    })

    afterEach(() => {
      sinon.restore()
    })

    type CreateDepsParams = {
      isNpmGlobalInstalled: boolean,
      isTTY: boolean
      notifier: NarrowedUpdateNotifier,
    }

    const createDeps = (params: CreateDepsParams): UpdateNotifierDeps => ({
      confirmPrompt: confirmStub,
      execSyncFn: execSyncStub,
      exitFn: exitStub,
      isNpmGlobalInstalled: params.isNpmGlobalInstalled,
      isTTY: params.isTTY,
      log: logStub,
      notifier: params.notifier
    })

    it('should do nothing when not installed via npm global', async () => {
      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: false,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(confirmStub.called).to.be.false
      expect(execSyncStub.called).to.be.false
    })

    it('should do nothing when no update is available', async () => {
      await handleUpdateNotification(
        createDeps({isNpmGlobalInstalled: true, isTTY: true, notifier: {notify: notifyStub, update: undefined}}),
      )

      expect(notifyStub.called).to.be.false
      expect(confirmStub.called).to.be.false
      expect(execSyncStub.called).to.be.false
    })

    it('should do nothing when current and latest versions are the same (stale cache)', async () => {
      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.5', latest: '1.0.5'}},
        }),
      )

      expect(confirmStub.called).to.be.false
      expect(execSyncStub.called).to.be.false
    })

    it('should do nothing when isTTY is false even if update is available', async () => {
      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: false,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(confirmStub.called).to.be.false
      expect(execSyncStub.called).to.be.false
    })

    it('should show notification and prompt when update is available in TTY', async () => {
      confirmStub.resolves(false)

      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(notifyStub.called).to.be.false
      expect(confirmStub.calledOnce).to.be.true
      expect(confirmStub.firstCall.args[0]).to.deep.equal({
        default: true,
        message: 'Update available: 1.0.0 → 2.0.0. Update now? (active sessions will be restarted)',
      })
      expect(execSyncStub.called).to.be.false
    })

    it('should execute npm update, run brv restart, and exit when user confirms', async () => {
      confirmStub.resolves(true)

      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(execSyncStub.calledTwice).to.be.true
      expect(execSyncStub.firstCall.args[0]).to.equal('npm update -g byterover-cli')
      expect(execSyncStub.secondCall.args[0]).to.equal('brv restart')
      expect(logStub.calledWith('Updating byterover-cli...')).to.be.true
      expect(logStub.calledWith('✓ Updated to 2.0.0. Restarting...')).to.be.true
      expect(exitStub.calledOnce).to.be.true
      expect(exitStub.calledWith(0)).to.be.true
    })

    it('should still exit 0 if brv restart fails after successful npm update', async () => {
      confirmStub.resolves(true)
      execSyncStub.onFirstCall().returns(undefined as never)
      execSyncStub.onSecondCall().throws(new Error('restart failed'))

      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(execSyncStub.calledTwice).to.be.true
      expect(execSyncStub.firstCall.args[0]).to.equal('npm update -g byterover-cli')
      expect(execSyncStub.secondCall.args[0]).to.equal('brv restart')
      expect(exitStub.calledOnce).to.be.true
      expect(exitStub.calledWith(0)).to.be.true
    })

    it('should show error message when npm update fails', async () => {
      confirmStub.resolves(true)
      execSyncStub.throws(new Error('npm update failed'))

      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(execSyncStub.calledOnce).to.be.true
      expect(logStub.calledWith('⚠️  Automatic update failed. Please run manually: npm update -g byterover-cli')).to.be
        .true
    })

    it('should not execute update when user declines', async () => {
      confirmStub.resolves(false)

      await handleUpdateNotification(
        createDeps({
          isNpmGlobalInstalled: true,
          isTTY: true,
          notifier: {notify: notifyStub, update: {current: '1.0.0', latest: '2.0.0'}},
        }),
      )

      expect(execSyncStub.called).to.be.false
      expect(logStub.called).to.be.false
    })
  })

  describe('isNpmGlobalInstall', () => {
    it('should return true when npm list succeeds', () => {
      const execSyncStub = sinon.stub().returns(Buffer.from(''))
      expect(isNpmGlobalInstall(execSyncStub as unknown as typeof import('node:child_process').execSync)).to.be.true
      expect(execSyncStub.calledOnce).to.be.true
      expect(execSyncStub.firstCall.args[0]).to.equal('npm list -g byterover-cli --depth=0')
    })

    it('should return false when npm list throws', () => {
      const execSyncStub = sinon.stub().throws(new Error('not found'))
      expect(isNpmGlobalInstall(execSyncStub as unknown as typeof import('node:child_process').execSync)).to.be.false
    })
  })
})
