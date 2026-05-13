import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Dream from '../../src/oclif/commands/dream.js'

// ==================== TestableDreamCommand ====================

class TestableDreamCommand extends Dream {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    }
  }
}

// ==================== Tests ====================

describe('Dream Command', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []

    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getDaemonVersion: stub(),
      getState: stub().returns('connected'),
      isConnected: stub().resolves(true),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({activeProvider: 'anthropic'}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableDreamCommand {
    const command = new TestableDreamCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableDreamCommand {
    const command = new TestableDreamCommand([...argv, '--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
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

  // ==================== Detach Mode ====================

  describe('detach mode', () => {
    it('should submit task and exit immediately with confirmation', async () => {
      await createCommand('--detach').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.callCount).to.equal(2)
      expect(requestStub.firstCall.args[0]).to.equal('state:getProviderConfig')
      const [event, payload] = requestStub.secondCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('type', 'dream')
      expect(payload).to.have.property('taskId').that.is.a('string')
      expect(loggedMessages.some((m) => m.includes('Dream queued for processing'))).to.be.true
    })

    it('should include force in task payload when combined with --force', async () => {
      await createCommand('--detach', '--force').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const [, payload] = requestStub.secondCall.args
      expect(payload).to.have.property('force', true)
    })

    it('should warn when --timeout is used with --detach', async () => {
      await createCommand('--detach', '--timeout', '600').run()

      expect(loggedMessages).to.include('Note: --timeout has no effect with --detach')
    })

    it('should not warn about --timeout with --detach when using default', async () => {
      await createCommand('--detach').run()

      expect(loggedMessages).to.not.include('Note: --timeout has no effect with --detach')
    })

    it('should not warn about --timeout in JSON mode even when non-default', async () => {
      await createJsonCommand('--detach', '--timeout', '600').run()

      expect(loggedMessages).to.not.include('Note: --timeout has no effect with --detach')
    })

    it('should output JSON on detach', async () => {
      await createJsonCommand('--detach').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('dream')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('status', 'queued')
      expect(json.data).to.have.property('taskId').that.is.a('string')
      expect(json.data).to.have.property('message', 'Dream queued for processing')
    })

    it('should output JSON on detach with --force', async () => {
      await createJsonCommand('--detach', '--force').run()

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.data).to.have.property('status', 'queued')
    })

    it('should disconnect client after detach', async () => {
      await createCommand('--detach').run()

      expect(mockClient.disconnect.calledOnce).to.be.true
    })
  })

  // ==================== --cancel flag (T2.4) ====================

  describe('--cancel flag', () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- captures mockClient from outer beforeEach
    function stubCancelResponse(response: {error?: string; success: boolean}): void {
      ;(mockClient.requestWithAck as sinon.SinonStub).callsFake(async (event: string) => {
        if (event === 'task:cancel') return response
        return {activeProvider: 'anthropic'}
      })
    }

    it('short-circuits the dream flow: emits task:cancel only, never starts a dream', async () => {
      stubCancelResponse({success: true})

      await createCommand('--cancel', 'task-A').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const eventNames = requestStub.getCalls().map((c) => c.args[0])
      expect(eventNames).to.deep.equal(['task:cancel'])
      expect(requestStub.firstCall.args[1]).to.deep.equal({taskId: 'task-A'})
    })

    it('prints "Cancelled <id>" on success (text format)', async () => {
      stubCancelResponse({success: true})

      await createCommand('--cancel', 'task-B').run()

      expect(loggedMessages).to.include('Cancelled task-B')
    })

    it('prints failure line with daemon-reported reason and exits non-zero (text)', async () => {
      stubCancelResponse({error: 'Task not found', success: false})

      let exitError: unknown
      try {
        await createCommand('--cancel', 'task-X').run()
      } catch (error) {
        exitError = error
      }

      expect(loggedMessages.some((m) => m.includes('Failed to cancel task-X') && m.includes('Task not found'))).to.be.true
      expect(exitError).to.not.equal(undefined)
    })

    it('emits the project JSON envelope (success)', async () => {
      stubCancelResponse({success: true})

      await createJsonCommand('--cancel', 'task-J').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('dream')
      expect(json.success).to.equal(true)
      expect(json.data).to.deep.include({status: 'cancelled', taskId: 'task-J'})
    })

    it('emits the project JSON envelope (failure)', async () => {
      stubCancelResponse({error: 'Task not found', success: false})

      try {
        await createJsonCommand('--cancel', 'task-K').run()
      } catch {
        // ExitError
      }

      const json = parseJsonOutput()
      expect(json.command).to.equal('dream')
      expect(json.success).to.equal(false)
      expect(json.data).to.deep.include({error: 'Task not found', status: 'error', taskId: 'task-K'})
    })

    it('rejects --cancel together with --force (mutually exclusive)', async () => {
      stubCancelResponse({success: true})

      let parseError: unknown
      try {
        await createCommand('--cancel', 'task-Z', '--force').run()
      } catch (error) {
        parseError = error
      }

      expect(parseError).to.not.equal(undefined)
      expect((mockClient.requestWithAck as sinon.SinonStub).called).to.equal(false)
    })

    it('rejects --cancel together with --undo (mutually exclusive)', async () => {
      stubCancelResponse({success: true})

      let parseError: unknown
      try {
        await createCommand('--cancel', 'task-Z', '--undo').run()
      } catch (error) {
        parseError = error
      }

      expect(parseError).to.not.equal(undefined)
      expect((mockClient.requestWithAck as sinon.SinonStub).called).to.equal(false)
    })

    it('rejects --cancel together with --detach (mutually exclusive)', async () => {
      stubCancelResponse({success: true})

      let parseError: unknown
      try {
        await createCommand('--cancel', 'task-Z', '--detach').run()
      } catch (error) {
        parseError = error
      }

      expect(parseError).to.not.equal(undefined)
      expect((mockClient.requestWithAck as sinon.SinonStub).called).to.equal(false)
    })

    it('allows --cancel alongside --timeout (timeout has no effect on the cancel branch)', async () => {
      stubCancelResponse({success: true})

      let parseError: unknown
      try {
        await createCommand('--cancel', 'task-T', '--timeout', '60').run()
      } catch (error) {
        parseError = error
      }

      expect(parseError).to.equal(undefined)
      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const eventNames = requestStub.getCalls().map((c) => c.args[0])
      expect(eventNames).to.deep.equal(['task:cancel'])
    })
  })
})
