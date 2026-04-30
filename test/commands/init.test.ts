import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {DaemonClientOptions} from '../../src/oclif/lib/daemon-client.js'

import Init from '../../src/oclif/commands/init.js'

/**
 * Default responses for daemon events during init flow.
 * Simulates: project initialized, provider already connected.
 */
const DEFAULT_EVENT_RESPONSES: Record<string, unknown> = {
  'init:local': {alreadyInitialized: false, success: true},
  'provider:getActive': {activeProviderId: 'byterover'},
}

class TestableInitCommand extends Init {
  public runCommandCalls: string[] = []
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(mockConnector: () => Promise<ConnectionResult>, config: Config, argv: string[] = []) {
    super(argv, config)
    this.mockConnector = mockConnector
    this.config.runCommand = stub().callsFake(async (id: string) => {
      this.runCommandCalls.push(id)
    }) as Config['runCommand']
  }

  protected override getDaemonOptions(): DaemonClientOptions {
    return {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    }
  }
}

describe.skip('Init Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []

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
      requestWithAck: stub().callsFake((event: string) =>
        Promise.resolve(DEFAULT_EVENT_RESPONSES[event] ?? {}),
      ),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(argv: string[] = []): TestableInitCommand {
    const command = new TestableInitCommand(mockConnector, config, argv)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return command
  }

  function mockEvent(event: string, response: unknown): void {
    ;(mockClient.requestWithAck as sinon.SinonStub).callsFake((evt: string) => {
      if (evt === event) return Promise.resolve(response)
      return Promise.resolve(DEFAULT_EVENT_RESPONSES[evt] ?? {})
    })
  }

  describe('successful initialization', () => {
    it('should display ready message when project is newly initialized', async () => {
      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('ByteRover is ready'))).to.be.true
    })

    it('should display already initialized message and stop when project exists', async () => {
      mockEvent('init:local', {alreadyInitialized: true, success: true})

      const command = createCommand()
      await command.run()

      expect(loggedMessages.some((m) => m.includes('already initialized'))).to.be.true
      expect(command.runCommandCalls).to.be.empty
    })
  })

  describe('sub-command delegation', () => {
    it('should call vc:init after local init', async () => {
      const command = createCommand()
      await command.run()

      expect(command.runCommandCalls).to.include('vc:init')
    })

    it('should call providers:connect when no provider configured', async () => {
      mockEvent('provider:getActive', {activeProviderId: ''})

      const command = createCommand()
      await command.run()

      expect(command.runCommandCalls).to.include('providers:connect')
    })

    it('should skip providers:connect when provider already configured', async () => {
      const command = createCommand()
      await command.run()

      expect(command.runCommandCalls).to.not.include('providers:connect')
    })

    it('should call connectors:install after local init', async () => {
      const command = createCommand()
      await command.run()

      expect(command.runCommandCalls).to.include('connectors:install')
    })

    it('should not call sub-commands if local init fails', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      const command = createCommand()
      await command.run()

      expect(command.runCommandCalls).to.be.empty
    })

    // Note: this test bypasses oclif's runCommand to simulate error propagation.
    // Integration verification needed to confirm ExitPromptError survives the real oclif command runner.
    it('should stop after providers:connect is cancelled by user', async () => {
      mockEvent('provider:getActive', {activeProviderId: ''})
      const command = createCommand()
      // Make providers:connect throw a cancellation error
      ;(command.config.runCommand as sinon.SinonStub).callsFake(async (id: string) => {
        command.runCommandCalls.push(id)
        if (id === 'providers:connect') {
          const err = new Error('cancelled')
          err.name = 'ExitPromptError'
          throw err
        }
      })
      await command.run()

      expect(command.runCommandCalls).to.include('providers:connect')
      expect(command.runCommandCalls).to.not.include('connectors:install')
    })
  })

  describe('force flag', () => {
    it('should pass force flag to init:local', async () => {
      const command = createCommand(['--force'])
      await command.run()

      const firstCall = (mockClient.requestWithAck as sinon.SinonStub).firstCall.args
      expect(firstCall[1]).to.deep.include({force: true})
    })
  })

  describe('connection errors', () => {
    it('should handle daemon not running', async () => {
      mockConnector.rejects(new NoInstanceRunningError())

      await createCommand().run()

      expect(loggedMessages.some((m) => m.includes('Daemon failed to start automatically'))).to.be.true
    })
  })
})
