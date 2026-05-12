import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import SettingsSet from '../../../src/oclif/commands/settings/set.js'
import {SettingsEvents} from '../../../src/shared/transport/events/settings-events.js'

class TestableSettingsSet extends SettingsSet {
  private readonly mockConnector: () => Promise<ConnectionResult>

  public constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override async writeSetting(key: string, value: unknown) {
    return super.writeSetting(key, value, {
      maxRetries: 1,
      retryDelayMs: 0,
      transportConnector: this.mockConnector,
    })
  }
}

describe('brv settings set', () => {
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
      requestWithAck: stub().resolves({ok: true, restartRequired: true}),
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

  function createCommand(...argv: string[]): TestableSettingsSet {
    const command = new TestableSettingsSet(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableSettingsSet {
    const command = new TestableSettingsSet(['--format', 'json', ...argv], mockConnector, config)
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

  it('parses an integer-like argument and dispatches SET with a number value', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({ok: true, restartRequired: true})

    await createCommand('agentPool.maxSize', '25').run()

    expect(requestStub.calledOnce).to.be.true
    const {args} = requestStub.firstCall
    expect(args[0]).to.equal(SettingsEvents.SET)
    expect(args[1]).to.deep.equal({key: 'agentPool.maxSize', value: 25})
  })

  it('sends a non-numeric argument as a string for the daemon to reject', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      error: {code: 'invalid_value', key: 'agentPool.maxSize', message: 'expected integer'},
      ok: false,
    })

    await createCommand('agentPool.maxSize', 'abc').run()

    const {args} = requestStub.firstCall
    expect(args[1]).to.deep.equal({key: 'agentPool.maxSize', value: 'abc'})
  })

  it('prints "Setting saved. Run `brv restart` to apply." on success', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({ok: true, restartRequired: true})

    await createCommand('agentPool.maxSize', '25').run()

    expect(loggedMessages.some((m) => m.includes('Setting saved') && m.includes('brv restart'))).to.be.true
    expect(process.exitCode ?? 0).to.equal(0)
  })

  it('prints the daemon error and sets exit code 1 on invalid_value', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      error: {code: 'invalid_value', key: 'agentPool.maxSize', message: 'value 0 is outside allowed range', value: 0},
      ok: false,
    })

    await createCommand('agentPool.maxSize', '0').run()

    expect(loggedMessages.some((m) => m.includes('outside allowed range'))).to.be.true
    expect(process.exitCode).to.equal(1)
  })

  it('outputs JSON success payload', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({ok: true, restartRequired: true})

    await createJsonCommand('agentPool.maxSize', '25').run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings set')
    expect(json.success).to.be.true
    expect(json.data).to.have.property('restartRequired', true)
  })

  it('outputs JSON error payload and sets exit code 1 on validation failure', async () => {
    const requestStub = mockClient.requestWithAck as sinon.SinonStub
    requestStub.resolves({
      error: {code: 'invalid_value', key: 'agentPool.maxSize', message: 'too high', value: 999},
      ok: false,
    })

    await createJsonCommand('agentPool.maxSize', '999').run()

    const json = parseJsonOutput()
    expect(json.command).to.equal('settings set')
    expect(json.success).to.be.false
    expect(json.data).to.have.property('error')
    expect(process.exitCode).to.equal(1)
  })

  it('emits a one-line help mentioning the restart-required behavior', () => {
    expect(SettingsSet.description ?? '').to.match(/restart/i)
  })
})
