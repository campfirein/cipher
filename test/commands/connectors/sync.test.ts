import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import ConnectorsSync from '../../../src/oclif/commands/connectors/sync.js'

// ==================== TestableConnectorsSyncCommand ====================

class TestableConnectorsSyncCommand extends ConnectorsSync {
  private readonly mockProjectRoot: string | undefined

  constructor(argv: string[], config: Config, mockProjectRoot: string | undefined) {
    super(argv, config)
    this.mockProjectRoot = mockProjectRoot
  }

  override getProjectRoot(): string | undefined {
    return this.mockProjectRoot
  }

  // performSync is NOT overridden — tests exercise the real disabled contract
}

// ==================== Tests ====================

describe('Connectors Sync Command (disabled)', () => {
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

  function createCommand(mockProjectRoot: string | undefined = undefined, ...argv: string[]): TestableConnectorsSyncCommand {
    const command = new TestableConnectorsSyncCommand(argv, config, mockProjectRoot)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })

    return command
  }

  function createJsonCommand(mockProjectRoot: string | undefined = undefined): TestableConnectorsSyncCommand {
    const command = new TestableConnectorsSyncCommand(['--format', 'json'], config, mockProjectRoot)
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
      const command = createCommand()
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
      const command = createJsonCommand()

      await command.run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.command).to.equal('connectors sync')
      expect((json.data as {error: string}).error).to.include('No ByteRover project found')
    })
  })

  // ==================== Disabled behavior (text mode) ====================

  describe('disabled behavior (text mode)', () => {
    it('throws "Skill export is disabled" when performSync is called', async () => {
      const command = createCommand('/project')
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

      expect(errorMessage).to.include('Skill export is disabled')
    })
  })

  // ==================== Disabled behavior (JSON mode) ====================

  describe('disabled behavior (json mode)', () => {
    it('outputs JSON error with disabled message', async () => {
      const command = createJsonCommand('/project')

      await command.run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.command).to.equal('connectors sync')
      expect((json.data as {error: string}).error).to.include('Skill export is disabled')
    })
  })
})
