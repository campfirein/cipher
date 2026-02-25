import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Curate from '../../src/oclif/commands/curate/index.js'

// ==================== TestableCurateCommand ====================

class TestableCurateCommand extends Curate {
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

describe('Curate Command', () => {
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

  function createCommand(...argv: string[]): TestableCurateCommand {
    const command = new TestableCurateCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableCurateCommand {
    const command = new TestableCurateCommand([...argv, '--format', 'json'], mockConnector, config)
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

  // ==================== Input Validation ====================

  describe('input validation', () => {
    it('should show usage message when neither context nor files are provided', async () => {
      await createCommand().run()

      expect(loggedMessages).to.include('Either a context argument, file reference, or folder reference is required.')
    })

    it('should treat whitespace-only context as no context', async () => {
      await createCommand('   ').run()

      expect(loggedMessages).to.include('Either a context argument, file reference, or folder reference is required.')
    })

    it('should output JSON error when no input provided in json mode', async () => {
      await createJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('message').that.includes('Either a context argument')
    })
  })

  // ==================== Provider Validation ====================

  describe('provider validation', () => {
    it('should error when no provider is connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({activeProvider: ''})

      await createCommand('test context', '--detach').run()

      expect(loggedMessages.some((m) => m.includes('No provider connected'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('brv provider connect'))).to.be.true
    })

    it('should output JSON error when no provider is connected', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({activeProvider: ''})

      await createJsonCommand('test context', '--detach').run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error').that.includes('No provider connected')
    })
  })

  // ==================== Detach Mode ====================

  describe('detach mode', () => {
    it('should send task:create with context and taskId', async () => {
      await createCommand('test context', '--detach').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.calledTwice).to.be.true
      expect(requestStub.firstCall.args[0]).to.equal('state:getProviderConfig')
      const [event, payload] = requestStub.secondCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId').that.is.a('string')
      expect(loggedMessages).to.include('✓ Context queued for processing.')
    })

    it('should send task:create with empty content when only files provided', async () => {
      await createCommand('--detach', '-f', 'src/auth.ts', '-f', 'src/utils.ts').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      expect(requestStub.calledTwice).to.be.true
      expect(requestStub.firstCall.args[0]).to.equal('state:getProviderConfig')
      const [event, payload] = requestStub.secondCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', '')
      expect(payload).to.have.property('files').that.deep.equals(['src/auth.ts', 'src/utils.ts'])
      expect(payload).to.have.property('type', 'curate')
    })

    it('should send task:create with context and files', async () => {
      await createCommand('test context', '--detach', '-f', 'file1.ts', '-f', 'file2.ts').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const [, payload] = requestStub.secondCall.args
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('files').that.deep.equals(['file1.ts', 'file2.ts'])
    })

    it('should disconnect client after successful request', async () => {
      await createCommand('test context', '--detach').run()

      expect(mockClient.disconnect.calledOnce).to.be.true
    })

    it('should output JSON on detach', async () => {
      await createJsonCommand('test context', '--detach').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('curate')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('status', 'queued')
      expect(json.data).to.have.property('taskId').that.is.a('string')
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand('test context', '--detach').run()

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockConnector.rejects(new InstanceCrashedError())

      await createCommand('test context', '--detach').run()

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand('test context', '--detach').run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand('test context', '--detach').run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })

    it('should disconnect client even when request fails', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).rejects(new Error('Request failed'))

      await createCommand('test context', '--detach').run()

      expect(mockClient.disconnect.calledOnce).to.be.true
    })

    it('should output JSON on connection error', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createJsonCommand('test context', '--detach').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('curate')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })
  })
})
