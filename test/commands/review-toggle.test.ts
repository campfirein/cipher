import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Review from '../../src/oclif/commands/review.js'
import {ReviewEvents} from '../../src/shared/transport/events/review-events.js'

class TestableReview extends Review {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

describe('Review (top-level toggle command)', () => {
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
      requestWithAck: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    mockConnector = stub<[], Promise<ConnectionResult>>().resolves({
      client: mockClient as unknown as ITransportClient,
      projectRoot: '/test/project',
    })
  })

  afterEach(() => {
    restore()
  })

  function makeCommand(...argv: string[]): TestableReview {
    const cmd = new TestableReview(argv, mockConnector, config)
    stub(cmd, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return cmd
  }

  function makeJsonCommand(...argv: string[]): TestableReview {
    const cmd = new TestableReview([...argv, '--format', 'json'], mockConnector, config)
    stub(cmd, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return cmd
  }

  function parseJsonOutput(): {command: string; data: Record<string, unknown>; success: boolean} {
    return JSON.parse(stdoutOutput.join('').trim())
  }

  describe('--disable', () => {
    it('sends review:setDisabled with reviewDisabled=true', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: true})

      await makeCommand('--disable').run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.SET_DISABLED)
      expect(call.args[1]).to.deep.equal({reviewDisabled: true})
    })

    it('prints confirmation in text mode', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: true})

      await makeCommand('--disable').run()

      expect(loggedMessages.some((m) => m.toLowerCase().includes('disabled'))).to.be.true
    })

    it('outputs JSON success in json mode', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: true})

      await makeJsonCommand('--disable').run()

      const json = parseJsonOutput()
      expect(json.command).to.equal('review')
      expect(json.success).to.be.true
      expect(json.data).to.have.property('reviewDisabled', true)
    })

    it('reports error when daemon rejects (project not initialized)', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).rejects(
        new Error('Project not initialized: /test/project. Run `brv init` first.'),
      )

      await makeJsonCommand('--disable').run()

      const json = parseJsonOutput()
      expect(json.success).to.be.false
      expect(json.data).to.have.property('status', 'error')
      expect(String(json.data.error)).to.match(/not initialized/i)
    })
  })

  describe('--enable', () => {
    it('sends review:setDisabled with reviewDisabled=false', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: false})

      await makeCommand('--enable').run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.SET_DISABLED)
      expect(call.args[1]).to.deep.equal({reviewDisabled: false})
    })

    it('prints confirmation in text mode', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: false})

      await makeCommand('--enable').run()

      expect(loggedMessages.some((m) => m.toLowerCase().includes('enabled'))).to.be.true
    })
  })

  describe('without flags (status)', () => {
    it('sends review:getDisabled and prints enabled when reviewDisabled=false', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: false})

      await makeCommand().run()

      const call = (mockClient.requestWithAck as sinon.SinonStub).firstCall
      expect(call.args[0]).to.equal(ReviewEvents.GET_DISABLED)
      expect(loggedMessages.some((m) => m.toLowerCase().includes('enabled'))).to.be.true
    })

    it('prints disabled when reviewDisabled=true', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: true})

      await makeCommand().run()

      expect(loggedMessages.some((m) => m.toLowerCase().includes('disabled'))).to.be.true
    })

    it('outputs JSON status', async () => {
      ;(mockClient.requestWithAck as sinon.SinonStub).resolves({reviewDisabled: false})

      await makeJsonCommand().run()

      const json = parseJsonOutput()
      expect(json.success).to.be.true
      expect(json.data).to.have.property('reviewDisabled', false)
    })
  })

  describe('flag validation', () => {
    it('rejects passing both --disable and --enable', async () => {
      let threw = false
      try {
        await makeCommand('--disable', '--enable').run()
      } catch {
        threw = true
      }

      expect(threw).to.be.true
      expect((mockClient.requestWithAck as sinon.SinonStub).called).to.be.false
    })
  })
})
