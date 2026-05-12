import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Settings from '../../../src/oclif/commands/settings/index.js'
import {SettingsEvents} from '../../../src/shared/transport/events/settings-events.js'

class TestableSettings extends Settings {
  private readonly mockConnector: () => Promise<ConnectionResult>

  public constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchSettings() {
    return super.fetchSettings({
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

describe('brv settings (index)', () => {
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
      requestWithAck: stub().resolves({items: []}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableSettings {
    const command = new TestableSettings(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableSettings {
    const command = new TestableSettings(['--format', 'json', ...argv], mockConnector, config)
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

  it('dispatches SettingsEvents.LIST through the transport client', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({items: []})

    await createCommand().run()

    expect(requestStub.calledOnceWith(SettingsEvents.LIST)).to.be.true
  })

  it('prints a table row per registered setting with KEY/CURRENT/DEFAULT/RESTART columns', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      items: [
        {
          current: 25,
          default: 10,
          description: 'Maximum number of concurrent active projects.',
          key: 'agentPool.maxSize',
          max: 100,
          min: 1,
          restartRequired: true,
          type: 'integer',
        },
      ],
    })

    await createCommand().run()

    const headerLine = loggedMessages.find((m) => m.includes('KEY') && m.includes('CURRENT'))
    expect(headerLine, 'header line').to.exist
    expect(headerLine).to.include('DEFAULT')
    expect(headerLine).to.include('RESTART')

    const rowLine = loggedMessages.find((m) => m.includes('agentPool.maxSize'))
    expect(rowLine, 'row for agentPool.maxSize').to.exist
    expect(rowLine).to.include('25')
    expect(rowLine).to.include('10')
    expect(rowLine).to.include('yes')
  })

  it('emits a one-line help mentioning the restart-required behavior', () => {
    const description = Settings.description ?? ''
    expect(description).to.match(/restart/i)
  })

  it('outputs the raw items array under --format json', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      items: [
        {
          current: 25,
          default: 10,
          description: 'Maximum number of concurrent active projects.',
          key: 'agentPool.maxSize',
          max: 100,
          min: 1,
          restartRequired: true,
          type: 'integer',
        },
      ],
    })

    await createJsonCommand().run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings')
    expect(json.success).to.be.true
    expect(json.data).to.have.property('items').that.is.an('array').with.lengthOf(1)
  })

  it('outputs JSON error on connection failure', async () => {
    mockConnector.rejects(new Error('Connection failed'))

    await createJsonCommand().run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings')
    expect(json.success).to.be.false
    expect(json.data).to.have.property('error')
  })

  it('logs a connection error message in text mode', async () => {
    mockConnector.rejects(new Error('Connection failed'))

    await createCommand().run()

    expect(loggedMessages.some((m) => m.includes('Connection failed'))).to.be.true
  })
})
