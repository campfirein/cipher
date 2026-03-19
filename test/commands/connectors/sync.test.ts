import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ConnectorSyncResponse} from '../../../src/shared/transport/events/connector-events.js'

import ConnectorsSync from '../../../src/oclif/commands/connectors/sync.js'

// ==================== TestableConnectorsSyncCommand ====================

class TestableConnectorsSyncCommand extends ConnectorsSync {
  private readonly mockProjectRoot: string | undefined
  private readonly mockSyncResult: ConnectorSyncResponse

  constructor(
    argv: string[],
    config: Config,
    mockProjectRoot: string | undefined,
    mockSyncResult: ConnectorSyncResponse,
  ) {
    super(argv, config)
    this.mockProjectRoot = mockProjectRoot
    this.mockSyncResult = mockSyncResult
  }

  protected override getProjectRoot(): string | undefined {
    return this.mockProjectRoot
  }

  protected override async performSync(_projectRoot: string): Promise<ConnectorSyncResponse> {
    return this.mockSyncResult
  }
}

// ==================== Tests ====================

describe('Connectors Sync Command', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []
  })

  afterEach(() => {
    restore()
  })

  const EMPTY_RESULT: ConnectorSyncResponse = {block: '', failed: [], updated: []}

  function makeResult(overrides: Partial<ConnectorSyncResponse> = {}): ConnectorSyncResponse {
    return {block: 'built knowledge', failed: [], updated: [], ...overrides}
  }

  function createCommand(
    mockProjectRoot: string | undefined,
    mockSyncResult: ConnectorSyncResponse,
    ...argv: string[]
  ): TestableConnectorsSyncCommand {
    const command = new TestableConnectorsSyncCommand(argv, config, mockProjectRoot, mockSyncResult)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(
    mockProjectRoot: string | undefined,
    mockSyncResult: ConnectorSyncResponse,
  ): TestableConnectorsSyncCommand {
    const command = new TestableConnectorsSyncCommand(
      ['--format', 'json'],
      config,
      mockProjectRoot,
      mockSyncResult,
    )
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  function parseJsonOutput(): {command: string; data: Record<string, unknown>; success: boolean} {
    const output = stdoutOutput.join('')
    return JSON.parse(output.trim())
  }

  // ==================== Strict project detection ====================

  describe('strict project detection', () => {
    it('errors when no project root found (outside a project)', async () => {
      const command = createCommand(undefined, EMPTY_RESULT)
      let errorMessage = ''
      sinon.stub(command, 'error').callsFake((msg: Error | string) => {
        errorMessage = typeof msg === 'string' ? msg : msg.message
        throw new Error(errorMessage)
      })

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch {
        // expected
      }

      expect(errorMessage).to.include('No ByteRover project found')
    })

    it('outputs JSON error when no project root and --format json', async () => {
      const command = createJsonCommand(undefined, EMPTY_RESULT)

      await command.run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.command).to.equal('connectors sync')
      expect((json.data as {error: string}).error).to.include('No ByteRover project found')
    })
  })

  // ==================== Text output ====================

  describe('text output', () => {
    it('shows no-knowledge message when block is empty', async () => {
      const result = makeResult({block: '', failed: [], updated: []})
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('No project knowledge accumulated yet'))).to.be.true
    })

    it('shows no-connectors message when targets are empty', async () => {
      const result = makeResult({failed: [], updated: []})
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('No skill connectors installed'))).to.be.true
    })

    it('shows updated targets with agent, scope, and path', async () => {
      const result = makeResult({
        updated: [{agent: 'Claude Code', path: '/project/.claude/skills/byterover/SKILL.md', scope: 'project'}],
      })
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('Synced to 1 target(s)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Claude Code') && m.includes('project'))).to.be.true
    })

    it('shows failed targets with agent, scope, and error', async () => {
      const result = makeResult({
        failed: [{agent: 'Cursor', error: 'disk full', scope: 'project'}],
        updated: [],
      })
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('Failed 1 target(s)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Cursor') && m.includes('disk full'))).to.be.true
    })

    it('shows both updated and failed when mixed results', async () => {
      const result = makeResult({
        failed: [{agent: 'Cursor', error: 'permission denied', scope: 'project'}],
        updated: [{agent: 'Claude Code', path: '/p/SKILL.md', scope: 'project'}],
      })
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('Synced to 1 target(s)'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Failed 1 target(s)'))).to.be.true
    })

    it('shows empty-block message AND target results (post-reset cleanup)', async () => {
      // Empty block but installed targets still get their markers cleaned up
      const result = makeResult({
        block: '',
        updated: [{agent: 'Claude Code', path: '/p/SKILL.md', scope: 'project'}],
      })
      await createCommand('/project', result).run()

      expect(loggedMessages.some((m) => m.includes('No project knowledge accumulated yet'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Synced to 1 target(s)'))).to.be.true
    })
  })

  // ==================== JSON output ====================

  describe('json output', () => {
    it('outputs JSON with success and block + updated + failed fields', async () => {
      const result = makeResult({
        updated: [{agent: 'Claude Code', path: '/p/SKILL.md', scope: 'project'}],
      })
      const command = createJsonCommand('/project', result)
      await command.run()

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.command).to.equal('connectors sync')
      expect(json.data).to.have.property('block')
      expect(json.data).to.have.property('updated').that.is.an('array')
      expect(json.data).to.have.property('failed').that.is.an('array')
    })

    it('outputs JSON error when performSync throws', async () => {
      const command = new TestableConnectorsSyncCommand(
        ['--format', 'json'],
        config,
        '/project',
        EMPTY_RESULT,
      )
      stub(command, 'log').callsFake((msg?: string) => {
        if (msg !== undefined) loggedMessages.push(msg)
      })
      stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
        stdoutOutput.push(String(chunk))
        return true
      })
      sinon.stub(command, 'performSync' as keyof TestableConnectorsSyncCommand).rejects(new Error('store broken'))

      await command.run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect((json.data as {error: string}).error).to.include('store broken')
    })
  })
})
