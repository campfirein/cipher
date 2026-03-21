import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {handleRestartAfterUpdate} from '../../../src/oclif/hooks/postrun/restart-after-update.js'

describe('restart-after-update hook', () => {
  let execSyncStub: ReturnType<typeof stub>
  let logStub: ReturnType<typeof stub>

  beforeEach(() => {
    execSyncStub = stub()
    logStub = stub()
  })

  afterEach(() => {
    restore()
  })

  it('should run brv restart after manual brv update', async () => {
    await handleRestartAfterUpdate({
      argv: [],
      commandId: 'update',
      execSyncFn: execSyncStub,
      log: logStub,
    })

    expect(logStub.calledWith('Restarting ByteRover...')).to.be.true
    expect(execSyncStub.calledOnce).to.be.true
    expect(execSyncStub.firstCall.args[0]).to.equal('brv restart')
  })

  it('should skip restart for auto-update (--autoupdate flag)', async () => {
    await handleRestartAfterUpdate({
      argv: ['--autoupdate'],
      commandId: 'update',
      execSyncFn: execSyncStub,
      log: logStub,
    })

    expect(logStub.called).to.be.false
    expect(execSyncStub.called).to.be.false
  })

  it('should skip restart for non-update commands', async () => {
    await handleRestartAfterUpdate({
      argv: [],
      commandId: 'status',
      execSyncFn: execSyncStub,
      log: logStub,
    })

    expect(logStub.called).to.be.false
    expect(execSyncStub.called).to.be.false
  })

  it('should not throw if brv restart fails', async () => {
    execSyncStub.throws(new Error('restart failed'))

    await handleRestartAfterUpdate({
      argv: [],
      commandId: 'update',
      execSyncFn: execSyncStub,
      log: logStub,
    })

    expect(logStub.calledWith('Restarting ByteRover...')).to.be.true
    expect(execSyncStub.calledOnce).to.be.true
  })

  it('should skip restart when commandId is undefined', async () => {
    await handleRestartAfterUpdate({
      argv: [],
      commandId: undefined,
      execSyncFn: execSyncStub,
      log: logStub,
    })

    expect(logStub.called).to.be.false
    expect(execSyncStub.called).to.be.false
  })
})
