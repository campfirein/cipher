import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {ConnectionFailedError, InstanceCrashedError, NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {AuthLoginWithApiKeyResponse} from '../../src/shared/transport/events/auth-events.js'

import Login from '../../src/oclif/commands/login.js'

// ==================== TestableLoginCommand ====================

class TestableLoginCommand extends Login {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async loginWithApiKey(apiKey: string): Promise<AuthLoginWithApiKeyResponse> {
    return super.loginWithApiKey(apiKey, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

// ==================== Tests ====================

describe('Login Command', () => {
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
      requestWithAck: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableLoginCommand {
    const command = new TestableLoginCommand(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableLoginCommand {
    const command = new TestableLoginCommand([...argv, '--format', 'json'], mockConnector, config)
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

  function mockLoginResponse(response: AuthLoginWithApiKeyResponse): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).resolves(response)
  }

  // ==================== Successful Login ====================

  describe('successful login', () => {
    it('should display success message with user email', async () => {
      mockLoginResponse({success: true, userEmail: 'user@example.com'})

      await createCommand('--api-key', 'valid-api-key').run()

      expect(loggedMessages.some((m) => m.includes('Logging in...'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Logged in as user@example.com'))).to.be.true
    })

    it('should send api key to transport handler', async () => {
      mockLoginResponse({success: true, userEmail: 'user@example.com'})

      await createCommand('--api-key', 'my-secret-key').run()

      expect((mockClient.requestWithAck as sinon.SinonStub).calledOnce).to.be.true
      const [event, data] = (mockClient.requestWithAck as sinon.SinonStub).firstCall.args
      expect(event).to.equal('auth:loginWithApiKey')
      expect(data).to.deep.equal({apiKey: 'my-secret-key'})
    })
  })

  // ==================== Failed Login ====================

  describe('failed login', () => {
    it('should display error message from handler', async () => {
      mockLoginResponse({error: 'Invalid API key', success: false})

      await createCommand('--api-key', 'invalid-key').run()

      expect(loggedMessages.some((m) => m.includes('Invalid API key'))).to.be.true
    })

    it('should display generic error when no error message provided', async () => {
      mockLoginResponse({success: false})

      await createCommand('--api-key', 'invalid-key').run()

      expect(loggedMessages.some((m) => m.includes('Authentication failed'))).to.be.true
    })
  })

  // ==================== JSON Format ====================

  describe('json format', () => {
    it('should output JSON on successful login', async () => {
      mockLoginResponse({success: true, userEmail: 'user@example.com'})

      await createJsonCommand('--api-key', 'valid-key').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('login')
      expect(json.success).to.be.true
      expect(json.data).to.deep.include({userEmail: 'user@example.com'})
    })

    it('should output JSON on failed login', async () => {
      mockLoginResponse({error: 'Invalid API key', success: false})

      await createJsonCommand('--api-key', 'invalid-key').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('login')
      expect(json.success).to.be.false
      expect(json.data).to.deep.include({error: 'Invalid API key'})
    })

    it('should output JSON on connection error', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createJsonCommand('--api-key', 'test-key').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('login')
      expect(json.success).to.be.false
      expect(json.data).to.have.property('error')
    })

    it('should not log "Logging in..." in json mode', async () => {
      mockLoginResponse({success: true, userEmail: 'user@example.com'})

      await createJsonCommand('--api-key', 'valid-key').run()

      expect(loggedMessages.some((m) => m.includes('Logging in...'))).to.be.false
    })
  })

  // ==================== Connection Errors ====================

  describe('connection errors', () => {
    it('should handle NoInstanceRunningError', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand('--api-key', 'test-key').run()

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockConnector.rejects(new InstanceCrashedError())

      await createCommand('--api-key', 'test-key').run()

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockConnector.rejects(new ConnectionFailedError(37_847, new Error('Connection refused')))

      await createCommand('--api-key', 'test-key').run()

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockConnector.rejects(new Error('Something went wrong'))

      await createCommand('--api-key', 'test-key').run()

      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })
  })
})
