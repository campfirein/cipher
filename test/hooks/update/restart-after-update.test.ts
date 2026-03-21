import {expect} from 'chai'
import {execSync} from 'node:child_process'
import * as sinon from 'sinon'

/**
 * Simulates the hook execution with injectable deps.
 * Mirrors the hook logic without importing the actual hook
 * (which uses real execSync and `this` context).
 */
async function runHook(deps: {execSyncFn: typeof execSync; log: (msg: string) => void}): Promise<void> {
  if (process.env.BRV_SKIP_ANALYTICS === '1') return

  deps.log('Restarting ByteRover...')
  try {
    deps.execSyncFn('brv restart', {stdio: 'inherit'})
  } catch {
    // best-effort — update already succeeded, process may have been killed by restart
  }
}

describe('restart-after-update hook', () => {
  let execSyncStub: sinon.SinonStub
  let logStub: sinon.SinonStub
  let originalSkipAnalytics: string | undefined

  beforeEach(() => {
    execSyncStub = sinon.stub()
    logStub = sinon.stub()
    originalSkipAnalytics = process.env.BRV_SKIP_ANALYTICS
  })

  afterEach(() => {
    sinon.restore()
    if (originalSkipAnalytics === undefined) {
      delete process.env.BRV_SKIP_ANALYTICS
    } else {
      process.env.BRV_SKIP_ANALYTICS = originalSkipAnalytics
    }
  })

  it('should run brv restart for manual brv update', async () => {
    delete process.env.BRV_SKIP_ANALYTICS

    await runHook({execSyncFn: execSyncStub as unknown as typeof execSync, log: logStub})

    expect(logStub.calledWith('Restarting ByteRover...')).to.be.true
    expect(execSyncStub.calledOnce).to.be.true
    expect(execSyncStub.firstCall.args[0]).to.equal('brv restart')
  })

  it('should skip restart for auto-update (BRV_SKIP_ANALYTICS=1)', async () => {
    process.env.BRV_SKIP_ANALYTICS = '1'

    await runHook({execSyncFn: execSyncStub as unknown as typeof execSync, log: logStub})

    expect(logStub.called).to.be.false
    expect(execSyncStub.called).to.be.false
  })

  it('should not throw if brv restart fails', async () => {
    delete process.env.BRV_SKIP_ANALYTICS
    execSyncStub.throws(new Error('restart failed'))

    await runHook({execSyncFn: execSyncStub as unknown as typeof execSync, log: logStub})

    expect(logStub.calledWith('Restarting ByteRover...')).to.be.true
    expect(execSyncStub.calledOnce).to.be.true
  })
})
