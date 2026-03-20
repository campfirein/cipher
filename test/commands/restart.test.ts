import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import Restart from '../../src/oclif/commands/restart.js'

// ==================== TestableRestartCommand ====================

class TestableRestartCommand extends Restart {
  public cleanupCalls: Array<{dataDir: string}> = []
  public exitCalls: Array<{code: number}> = []

  constructor(config: Config) {
    super([], config)
  }

  protected override cleanupAllDaemonFiles(dataDir: string): void {
    this.cleanupCalls.push({dataDir})
  }

  protected override exitProcess(code: number): void {
    this.exitCalls.push({code})
  }
}

// ==================== Tests ====================

describe('Restart Command', () => {
  let config: Config
  let loggedMessages: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
  })

  afterEach(() => {
    restore()
  })

  function createCommand(): TestableRestartCommand {
    const command = new TestableRestartCommand(config)
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

  describe('SERVER_AGENT_PATTERNS', () => {
    it('contains only brv-server.js and agent-process.js', () => {
      // Access via buildCliPatterns to verify separation — SERVER_AGENT_PATTERNS
      // is private, so we verify indirectly: buildCliPatterns must NOT include them.
      const cliPatterns = Restart.buildCliPatterns()
      expect(cliPatterns).to.not.include('brv-server.js')
      expect(cliPatterns).to.not.include('agent-process.js')
    })
  })

  describe('buildCliPatterns()', () => {
    it('never includes relative path patterns — avoids false positives with other oclif CLIs', () => {
      const patterns = Restart.buildCliPatterns()
      // Patterns derived from process.argv[1] may be relative in dev mode,
      // but hardcoded patterns must be absolute or specific package names.
      const hardcodedPatterns = patterns.filter((p) => p !== process.argv[1])
      for (const p of hardcodedPatterns) {
        expect(p.startsWith('./')).to.be.false
      }
    })

    it('includes run.js pattern for standard npm/build install', () => {
      // buildCliPatterns always includes byterover-cli/bin/run.js for npm global
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
})
