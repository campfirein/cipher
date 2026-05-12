import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import SettingsGet from '../../../src/oclif/commands/settings/get.js'
import {SettingsEvents} from '../../../src/shared/transport/events/settings-events.js'

class TestableSettingsGet extends SettingsGet {
  private readonly mockConnector: () => Promise<ConnectionResult>

  public constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async fetchSetting(key: string) {
    return super.fetchSetting(key, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

describe('brv settings get', () => {
  let config: Config
  let loggedMessages: string[]
  let stdoutOutput: string[]
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: sinon.SinonStub<[], Promise<ConnectionResult>>
  let originalExitCode: number | string | undefined

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    stdoutOutput = []
    originalExitCode = process.exitCode

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
      requestWithAck: stub().resolves({error: {code: 'unknown_key', key: 'x', message: 'no'}, ok: false}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    restore()
  })

  function createCommand(...argv: string[]): TestableSettingsGet {
    const command = new TestableSettingsGet(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableSettingsGet {
    const command = new TestableSettingsGet(['--format', 'json', ...argv], mockConnector, config)
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
    return JSON.parse(stdoutOutput.join('').trim())
  }

  it('dispatches SettingsEvents.GET with the requested key', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      current: 25,
      default: 10,
      description: 'desc',
      key: 'agentPool.maxSize',
      max: 100,
      min: 1,
      ok: true,
      restartRequired: true,
      type: 'integer',
    })

    await createCommand('agentPool.maxSize').run()

    expect(requestStub.calledOnceWith(SettingsEvents.GET, {key: 'agentPool.maxSize'})).to.be.true
  })

  it('prints "<current>  (default: <default>)" for a known key', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      current: 25,
      default: 10,
      description: 'desc',
      key: 'agentPool.maxSize',
      max: 100,
      min: 1,
      ok: true,
      restartRequired: true,
      type: 'integer',
    })

    await createCommand('agentPool.maxSize').run()

    expect(loggedMessages.some((m) => m.includes('25') && m.includes('default') && m.includes('10'))).to.be.true
    expect(process.exitCode ?? 0).to.equal(0)
  })

  it('prints the daemon error message and sets exit code 1 for an unknown_key error', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      error: {code: 'unknown_key', key: 'not.a.key', message: "Unknown settings key: 'not.a.key'"},
      ok: false,
    })

    await createCommand('not.a.key').run()

    expect(loggedMessages.some((m) => m.includes('not.a.key'))).to.be.true
    expect(process.exitCode).to.equal(1)
  })

  it('outputs JSON success payload for a known key', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      current: 25,
      default: 10,
      description: 'desc',
      key: 'agentPool.maxSize',
      max: 100,
      min: 1,
      ok: true,
      restartRequired: true,
      type: 'integer',
    })

    await createJsonCommand('agentPool.maxSize').run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings get')
    expect(json.success).to.be.true
    expect(json.data).to.have.property('current', 25)
    expect(json.data).to.have.property('default', 10)
  })

  it('outputs JSON error payload for unknown_key and sets exit code 1', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      error: {code: 'unknown_key', key: 'x', message: 'Unknown settings key'},
      ok: false,
    })

    await createJsonCommand('x').run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings get')
    expect(json.success).to.be.false
    expect(json.data).to.have.property('error')
    expect(process.exitCode).to.equal(1)
  })

  it('emits a one-line help mentioning the restart-required behavior', () => {
    const description = SettingsGet.description ?? ''
    expect(description).to.match(/restart/i)
  })
})
