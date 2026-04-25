import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {match, restore, type SinonStub, stub} from 'sinon'

import Restart from '../../src/oclif/commands/restart.js'

const {buildWindowsKillScript, parseProcStat, parseWindowsProcessTable} = Restart

// ==================== TestableRestartCommand ====================

class TestableRestartCommand extends Restart {
  public cleanupCalls: Array<{dataDir: string}> = []
  public exitCalls: Array<{code: number}> = []
  private _daemonInfo: undefined | {pid: number; port: number}

  constructor(config: Config, daemonInfo?: {pid: number; port: number}) {
    super([], config)
    this._daemonInfo = daemonInfo
  }

  protected override cleanupAllDaemonFiles(dataDir: string): void {
    this.cleanupCalls.push({dataDir})
  }

  protected override exitProcess(code: number): void {
    this.exitCalls.push({code})
  }

  protected override loadDaemonInfo(_dataDir: string): undefined | {pid: number; port: number} {
    return this._daemonInfo
  }
}

// ==================== Tests ====================

describe('Restart Command', () => {
  let config: Config
  let loggedMessages: string[]
  let patternKillStub: SinonStub
  let waitForProcessExitStub: SinonStub
  let killByPidStub: SinonStub
  let processKillStub: SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    // Stub private static methods to prevent real OS calls
    /* eslint-disable @typescript-eslint/no-explicit-any */
    patternKillStub = stub(Restart as any, 'patternKill')
    stub(Restart as any, 'sleep').resolves()
    waitForProcessExitStub = stub(Restart as any, 'waitForProcessExit').resolves(true)
    killByPidStub = stub(Restart as any, 'killByPid')
    /* eslint-enable @typescript-eslint/no-explicit-any */
    processKillStub = stub(process, 'kill')
  })

  afterEach(() => {
    restore()
  })

  function createCommand(daemonInfo?: {pid: number; port: number}): TestableRestartCommand {
    const command = new TestableRestartCommand(config, daemonInfo)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  it('cleans state files and exits with code 0', async () => {
    const command = createCommand()

    await command.run()

    expect(command.cleanupCalls).to.have.length(1)
    expect(command.exitCalls).to.have.length(1)
    expect(command.exitCalls[0].code).to.equal(0)
  })

  it('logs completion message', async () => {
    const command = createCommand()

    await command.run()

    expect(loggedMessages.some((m) => m.includes('All ByteRover processes stopped'))).to.be.true
  })

  it('executes phases in order: clients → daemon → orphans → cleanup', async () => {
    const callOrder: string[] = []
    patternKillStub.callsFake((patterns: string[]) => {
      if (patterns.some((p) => p.includes('brv-server.js'))) {
        callOrder.push('phase3:orphans')
      } else {
        callOrder.push('phase1:clients')
      }
    })
    processKillStub.withArgs(9999, 'SIGTERM').callsFake(() => {
      callOrder.push('phase2:daemon')
    })

    const command = createCommand({pid: 9999, port: 50_000})

    await command.run()

    expect(callOrder).to.deep.equal(['phase1:clients', 'phase2:daemon', 'phase3:orphans'])
    expect(command.cleanupCalls).to.have.length(1)
  })

  describe('Phase 2: daemon kill', () => {
    it('sends SIGTERM to daemon PID when daemon info exists', async () => {
      const command = createCommand({pid: 1234, port: 50_000})

      await command.run()

      expect(processKillStub.calledWith(1234, 'SIGTERM')).to.be.true
      expect(loggedMessages.some((m) => m.includes('PID 1234'))).to.be.true
    })

    it('falls back to SIGKILL when SIGTERM times out', async () => {
      waitForProcessExitStub.resolves(false) // simulate timeout
      const command = createCommand({pid: 5678, port: 50_000})

      await command.run()

      expect(processKillStub.calledWith(5678, 'SIGTERM')).to.be.true
      expect(killByPidStub.calledWith(5678)).to.be.true
    })

    it('skips SIGKILL when SIGTERM succeeds', async () => {
      waitForProcessExitStub.resolves(true) // graceful exit
      const command = createCommand({pid: 4321, port: 50_000})

      await command.run()

      expect(killByPidStub.called).to.be.false
    })

    it('treats ESRCH from SIGTERM as already dead', async () => {
      const command = createCommand({pid: 7777, port: 50_000})
      processKillStub.withArgs(7777, 'SIGTERM').throws(new Error('ESRCH'))

      await command.run()

      expect(killByPidStub.called).to.be.false
      expect(command.exitCalls[0].code).to.equal(0)
    })

    it('skips Phase 2 when no daemon info exists', async () => {
      const command = createCommand() // no daemon info

      await command.run()

      expect(processKillStub.neverCalledWith(match.number, 'SIGTERM')).to.be.true
      expect(loggedMessages.every((m) => !m.includes('Stopping daemon'))).to.be.true
    })
  })

  describe('SERVER_AGENT_PATTERNS', () => {
    it('are excluded from CLI patterns to prevent self-kill', () => {
      const cliPatterns = Restart.buildCliPatterns()
      expect(cliPatterns).to.not.include('brv-server.js')
      expect(cliPatterns).to.not.include('agent-process.js')
    })
  })

  describe('protected command exclusion', () => {
    it('passes skipProtected=true for Phase 1 (CLI clients)', async () => {
      const command = createCommand()

      await command.run()

      // Phase 1 call has skipProtected=true, Phase 3 does not
      const phase1Call = patternKillStub.getCall(0)
      const phase3Call = patternKillStub.getCall(1)
      expect(phase1Call.args[1]).to.be.true
      expect(phase3Call.args[1]).to.be.undefined
    })

    it('isProtectedCommand detects update in null-byte delimited cmdline (Linux)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isProtected = (Restart as any).isProtectedCommand.bind(Restart)
      // Positive: brv update variants
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0update\0')).to.be.true
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0update')).to.be.true
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0update\0--force\0')).to.be.true
      // Negative: other commands
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0restart\0')).to.be.false
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0status\0')).to.be.false
      // Negative: "update" as prefix of another argument
      expect(isProtected('node\0/usr/lib/byterover-cli/bin/run.js\0update-notifier\0')).to.be.false
    })

    it('isProtectedCommand detects update in space-delimited cmdline (macOS)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isProtected = (Restart as any).isProtectedCommand.bind(Restart)
      // Positive: brv update variants
      expect(isProtected('node /usr/lib/byterover-cli/bin/run.js update')).to.be.true
      expect(isProtected('node /usr/lib/byterover-cli/bin/run.js update --force')).to.be.true
      // Negative: other commands
      expect(isProtected('node /usr/lib/byterover-cli/bin/run.js restart')).to.be.false
      // Negative: "update" as part of a path or different argument
      expect(isProtected('node /home/user/update-project/bin/run.js restart')).to.be.false
    })
  })

  describe('buildCliPatterns()', () => {
    it('all patterns are absolute paths or package-scoped names', () => {
      const patterns = Restart.buildCliPatterns()
      for (const p of patterns) {
        const isAbsolute = p.startsWith('/')
        const isPackageScoped = p.includes('byterover-cli') || p.includes('bin')
        expect(isAbsolute || isPackageScoped, `pattern "${p}" is neither absolute nor package-scoped`).to.be.true
      }
    })

    it('includes run.js pattern for standard npm/build install', () => {
      const patterns = Restart.buildCliPatterns()
      expect(patterns.some((p) => p.includes('byterover-cli') && p.endsWith('run.js'))).to.be.true
    })

    it('includes bin/brv pattern for bundled oclif binary', () => {
      const patterns = Restart.buildCliPatterns()
      expect(patterns.some((p) => p.includes('bin') && p.endsWith('brv'))).to.be.true
    })

    it('includes run (no .js) sibling pattern for curl install', () => {
      const patterns = Restart.buildCliPatterns()
      // Should contain a pattern ending with /run (no .js extension)
      expect(patterns.some((p) => p.endsWith('/run') || p.endsWith(String.raw`\run`))).to.be.true
    })

    it('deduplicates patterns when argv1 matches a computed sibling', () => {
      // The Set deduplication should prevent the same pattern appearing twice
      const patterns = Restart.buildCliPatterns()
      const unique = new Set(patterns)
      expect(patterns.length).to.equal(unique.size)
    })
  })

  describe('Restart.ancestorPids()', () => {
    it('returns [self] when parent is pid 1 (init/launchd)', () => {
      const chain = Restart.ancestorPids(100, (pid) => (pid === 100 ? 1 : undefined))
      expect(chain).to.deep.equal([100])
    })

    it('walks a three-level chain (self → parent → grandparent)', () => {
      const tree: Record<number, number> = {30: 1, 40: 30, 50: 40}
      const chain = Restart.ancestorPids(50, (pid) => tree[pid])
      expect(chain).to.deep.equal([50, 40, 30])
    })

    it('walks a four-level chain (self → inner → shim → outer)', () => {
      // Mirrors brv-after-plugin-update process chain: node → inner bash → redirect shim → outer bash → zsh (exits chain)
      const tree: Record<number, number> = {99: 1, 100: 99, 200: 100, 300: 200, 400: 300}
      const chain = Restart.ancestorPids(400, (pid) => tree[pid])
      expect(chain).to.deep.equal([400, 300, 200, 100, 99])
    })

    it('stops when getPpidOf returns undefined (process exited mid-walk)', () => {
      const tree: Record<number, number | undefined> = {60: undefined, 70: 60}
      const chain = Restart.ancestorPids(70, (pid) => tree[pid])
      expect(chain).to.deep.equal([70, 60])
    })

    it('stops when a pid appears twice (defensive cycle guard)', () => {
      const chain = Restart.ancestorPids(10, (pid) => (pid === 10 ? 20 : pid === 20 ? 10 : undefined))
      expect(chain).to.deep.equal([10, 20])
    })

    it('does not include pid 1 itself (init is not a brv ancestor)', () => {
      const chain = Restart.ancestorPids(5, (pid) => (pid === 5 ? 1 : undefined))
      expect(chain).to.not.include(1)
    })
  })

  describe('buildWindowsKillScript()', () => {
    it('emits -ne <pid> for every excluded ancestor pid', () => {
      const script = buildWindowsKillScript(['bin/brv'], [100, 200, 300], false)
      expect(script).to.include('$_.ProcessId -ne 100')
      expect(script).to.include('$_.ProcessId -ne 200')
      expect(script).to.include('$_.ProcessId -ne 300')
    })

    it('filters out non-finite values (NaN, Infinity, undefined-cast) from the exclude clause', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const script = buildWindowsKillScript(['bin/brv'], [100, Number.NaN, 200, Number.POSITIVE_INFINITY] as any, false)
      expect(script).to.include('$_.ProcessId -ne 100')
      expect(script).to.include('$_.ProcessId -ne 200')
      expect(script).to.not.include('NaN')
      expect(script).to.not.include('Infinity')
      expect(script).to.not.include('undefined')
    })

    it('escapes single quotes in patterns to avoid PS string breakouts', () => {
      const script = buildWindowsKillScript(["path/with'quote"], [100], false)
      expect(script).to.include("path/with''quote")
    })

    it('appends protected-command filter when skipProtected=true', () => {
      const script = buildWindowsKillScript(['bin/brv'], [100], true)
      expect(script).to.include("-notlike '* update *'")
      expect(script).to.include("-notlike '* update'")
    })

    it('omits protected-command filter when skipProtected=false', () => {
      const script = buildWindowsKillScript(['bin/brv'], [100], false)
      expect(script).to.not.include('update')
    })

    it('emits $true fallback when excludePids is empty', () => {
      const script = buildWindowsKillScript(['bin/brv'], [], false)
      // Guard against a trailing dangling "-and" that breaks PS parsing
      expect(script).to.not.match(/-and\s*[}\s]*$/)
      expect(script).to.include('$true')
    })

    it('emits $true fallback when every excludePid is non-finite', () => {
      const script = buildWindowsKillScript(['bin/brv'], [Number.NaN, Number.POSITIVE_INFINITY], false)
      expect(script).to.not.match(/-and\s*[}\s]*$/)
      expect(script).to.include('$true')
      expect(script).to.not.include('NaN')
      expect(script).to.not.include('Infinity')
    })
  })

  describe('Restart.parseProcStat()', () => {
    it('parses ppid from a standard /proc/<pid>/stat line', () => {
      expect(parseProcStat('1234 (node) R 5678 1234 1234 0 -1 ...')).to.equal(5678)
    })

    it('handles comm containing spaces and parens', () => {
      expect(parseProcStat('1234 (my weird (cmd) name) R 5678 1234 ...')).to.equal(5678)
    })

    it('returns undefined when input has no close paren', () => {
      expect(parseProcStat('1234 node R 5678')).to.be.undefined
    })

    it('returns undefined when ppid field is missing', () => {
      expect(parseProcStat('1234 (node)')).to.be.undefined
    })

    it('returns undefined when ppid is non-numeric', () => {
      expect(parseProcStat('1234 (node) R notanumber 1234')).to.be.undefined
    })

    it('returns ppid 1 (init) correctly', () => {
      expect(parseProcStat('100 (bash) S 1 100 100 0')).to.equal(1)
    })
  })

  describe('Restart.parseWindowsProcessTable()', () => {
    it('parses two-column ProcessId,ParentProcessId output', () => {
      const table = parseWindowsProcessTable('100,1\n200,100\n300,200\n')
      expect(table.get(100)).to.equal(1)
      expect(table.get(200)).to.equal(100)
      expect(table.get(300)).to.equal(200)
    })

    it('skips header lines and blank lines', () => {
      const table = parseWindowsProcessTable('ProcessId,ParentProcessId\n\n100,1\n\n')
      expect(table.get(100)).to.equal(1)
      expect(table.size).to.equal(1)
    })

    it('skips malformed lines where either column is non-numeric', () => {
      const table = parseWindowsProcessTable('foo,bar\n100,1\nalpha,200\n')
      expect(table.size).to.equal(1)
      expect(table.get(100)).to.equal(1)
    })

    it('tolerates CRLF line endings', () => {
      const table = parseWindowsProcessTable('100,1\r\n200,100\r\n')
      expect(table.get(100)).to.equal(1)
      expect(table.get(200)).to.equal(100)
    })

    it('returns empty map for empty input', () => {
      expect(parseWindowsProcessTable('').size).to.equal(0)
    })
  })
})
