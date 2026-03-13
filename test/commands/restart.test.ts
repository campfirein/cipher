import type {EnsureDaemonResult} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import Restart from '../../src/oclif/commands/restart.js'

// ==================== TestableRestartCommand ====================

class TestableRestartCommand extends Restart {
  public cleanupCalls: Array<{dataDir: string}> = []
  public exitCalls: Array<{code: number}> = []
  public killCalls: Array<{dataDir: string}> = []
  public startCalls: Array<{serverPath: string}> = []
  private _startResults: EnsureDaemonResult[]

  constructor(startResults: EnsureDaemonResult[], config: Config) {
    super([], config)
    this._startResults = [...startResults]
  }

  protected override cleanupAllDaemonFiles(dataDir: string): void {
    this.cleanupCalls.push({dataDir})
  }

  protected override exitProcess(code: number): void {
    this.exitCalls.push({code})
  }

  protected override async killAllBrvProcesses(dataDir: string): Promise<void> {
    this.killCalls.push({dataDir})
  }

  protected override async startDaemon(serverPath: string): Promise<EnsureDaemonResult> {
    this.startCalls.push({serverPath})
    const result = this._startResults.shift()
    if (!result) throw new Error('No more mock start results configured')
    return result
  }
}

// ==================== Helpers ====================

function makeSuccess(pid = 1234, port = 50_000): EnsureDaemonResult {
  return {info: {pid, port}, started: true, success: true}
}

function makeFailure(reason: 'timeout' = 'timeout', spawnError?: string): EnsureDaemonResult {
  return spawnError ? {reason, spawnError, success: false} : {reason, success: false}
}

// ==================== Tests ====================

describe('Restart Command', () => {
  let config: Config
  let loggedMessages: string[]
  let thrownErrors: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    thrownErrors = []
  })

  afterEach(() => {
    restore()
  })

  function createCommand(startResults: EnsureDaemonResult[]): TestableRestartCommand {
    const command = new TestableRestartCommand(startResults, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(command, 'error').callsFake((msg: Error | string) => {
      const message = typeof msg === 'string' ? msg : msg.message
      thrownErrors.push(message)
      throw new Error(message) // oclif error() throws
    })
    return command
  }

  it('starts daemon successfully on first attempt when no daemon running', async () => {
    const command = createCommand([makeSuccess(1111, 49_200)])

    await command.run()

    expect(command.killCalls).to.have.length(1)
    expect(command.cleanupCalls).to.have.length(1)
    expect(command.startCalls).to.have.length(1)
    expect(loggedMessages.some((m) => m.includes('PID 1111') && m.includes('port 49200'))).to.be.true
  })

  it('retries on first failure and succeeds on second attempt', async () => {
    const command = createCommand([makeFailure(), makeSuccess(2222, 49_201)])

    await command.run()

    expect(command.killCalls).to.have.length(2)
    expect(command.cleanupCalls).to.have.length(2)
    expect(command.startCalls).to.have.length(2)
    expect(loggedMessages.some((m) => m.includes('Retrying'))).to.be.true
    expect(loggedMessages.some((m) => m.includes('PID 2222'))).to.be.true
  })

  it('errors after all 3 attempts fail', async () => {
    const command = createCommand([makeFailure(), makeFailure(), makeFailure()])

    try {
      await command.run()
    } catch {
      // expected — error() throws
    }

    expect(command.killCalls).to.have.length(3)
    expect(command.cleanupCalls).to.have.length(3)
    expect(command.startCalls).to.have.length(3)
    expect(thrownErrors.some((m) => m.includes('3 attempts'))).to.be.true
  })

  it('logs attempt number on retries', async () => {
    const command = createCommand([makeFailure(), makeFailure(), makeSuccess()])

    await command.run()

    expect(loggedMessages.some((m) => m.includes('Attempt 2/3'))).to.be.true
    expect(loggedMessages.some((m) => m.includes('Attempt 3/3'))).to.be.true
  })

  it('kills and cleans before every attempt', async () => {
    const command = createCommand([makeFailure(), makeSuccess()])

    await command.run()

    expect(command.killCalls).to.have.length(2)
    expect(command.cleanupCalls).to.have.length(2)
    expect(command.startCalls).to.have.length(2)
  })

  it('includes spawn error detail in failure message', async () => {
    const spawnErr = 'ENOENT: brv-server.js not found'
    const command = createCommand([makeFailure(), makeFailure(), makeFailure('timeout', spawnErr)])

    try {
      await command.run()
    } catch {
      // expected — error() throws
    }

    expect(thrownErrors.some((m) => m.includes(spawnErr))).to.be.true
  })

  it('includes spawn error detail in retry log when non-final attempt fails', async () => {
    const spawnErr = 'ENOENT: brv-server.js not found'
    const command = createCommand([makeFailure('timeout', spawnErr), makeSuccess()])

    await command.run()

    expect(loggedMessages.some((m) => m.includes(spawnErr) && m.includes('Retrying'))).to.be.true
  })

  it('does not log attempt number on first attempt', async () => {
    const command = createCommand([makeSuccess()])

    await command.run()

    expect(loggedMessages.every((m) => !m.includes('Attempt 1/'))).to.be.true
  })

  describe('buildKillPatterns()', () => {
    it('always includes daemon and agent filename patterns', () => {
      const patterns = Restart.buildKillPatterns('/some/bin', '/some/bin/run.js')
      expect(patterns).to.include('brv-server.js')
      expect(patterns).to.include('agent-process.js')
    })

    it('never includes relative path patterns — avoids false positives with other oclif CLIs', () => {
      const patterns = Restart.buildKillPatterns('/some/bin', '/some/bin/run.js')
      expect(patterns.some((p) => p.startsWith('./'))).to.be.false
    })

    it('includes run.js sibling pattern for standard npm/build install', () => {
      const brvBinDir = '/usr/local/lib/node_modules/byterover-cli/bin'
      const argv1 = '/usr/local/lib/node_modules/byterover-cli/bin/run.js'
      const patterns = Restart.buildKillPatterns(brvBinDir, argv1)
      expect(patterns.some((p) => p.includes('byterover-cli') && p.endsWith('run.js'))).to.be.true
      expect(patterns).to.include(argv1)
    })

    it('includes run (no .js) sibling pattern for curl install', () => {
      const brvBinDir = '/.brv-cli/bin'
      const argv1 = '/.brv-cli/bin/run'
      const patterns = Restart.buildKillPatterns(brvBinDir, argv1)
      expect(patterns).to.include('/.brv-cli/bin/run')
    })

    it('deduplicates patterns when argv1 matches a computed sibling', () => {
      const brvBinDir = '/some/bin'
      const argv1 = '/some/bin/run.js'
      const patterns = Restart.buildKillPatterns(brvBinDir, argv1)
      const count = patterns.filter((p) => p === '/some/bin/run.js').length
      expect(count).to.equal(1)
    })

    it('includes bin/brv pattern for bundled oclif binary', () => {
      const patterns = Restart.buildKillPatterns('/any/bin', '/any/bin/brv')
      // 'bin/brv' — platform-agnostic substring (path.join('bin', 'brv'))
      expect(patterns.some((p) => p.includes('bin') && p.endsWith('brv'))).to.be.true
    })
  })
})
