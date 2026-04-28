/**
 * `brv record-answer` CLI command tests (Phase 5 Task 5.4).
 *
 * Mirrors the brv-record-answer MCP tool surface for skill/hook-driven
 * agents. Verifies the CLI:
 *   - Requires the {query, answer, --fingerprint} triple
 *   - Sends task:create with type 'record-answer' and encoded content
 *   - Reports recorded:true / recorded:false in both text and JSON formats
 */

import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import RecordAnswer from '../../src/oclif/commands/record-answer.js'

class TestableRecordAnswer extends RecordAnswer {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

describe('RecordAnswer Command', () => {
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
      on: stub().callsFake((event: string, handler: (data: unknown) => void) => {
        if (event === 'task:completed') {
          setTimeout(() => handler(samplePayload()), 0)
        }

        return () => {}
      }),
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

  function samplePayload(): {result: string; taskId: string} {
    const lastCreateCall = (mockClient.requestWithAck as sinon.SinonStub).getCalls().find(
      (c) => c.args[0] === 'task:create',
    )
    const taskId = (lastCreateCall?.args[1] as {taskId?: string})?.taskId ?? 'unknown'
    const result = JSON.stringify({fingerprint: 'fp-1', recorded: true})
    return {result, taskId}
  }

  function createCommand(...argv: string[]): TestableRecordAnswer {
    const command = new TestableRecordAnswer(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableRecordAnswer {
    const command = new TestableRecordAnswer([...argv, '--format', 'json'], mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    stub(process.stdout, 'write').callsFake((chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    })
    return command
  }

  describe('input validation', () => {
    it('throws on missing positional args', async () => {
      try {
        await createCommand('--fingerprint', 'fp').run()
        expect.fail('expected oclif to throw on missing required args')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        expect(msg.toLowerCase()).to.match(/missing|required|query|answer/)
      }
    })

    it('throws when --fingerprint is omitted', async () => {
      try {
        await createCommand('q', 'a').run()
        expect.fail('expected oclif to throw on missing --fingerprint')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        expect(msg.toLowerCase()).to.include('fingerprint')
      }
    })
  })

  describe('task routing', () => {
    it('sends task:create with type "record-answer" and encoded payload', async () => {
      await createCommand('how does auth work', 'Auth uses JWTs', '--fingerprint', 'fp-1').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const createCall = requestStub.getCalls().find((c) => c.args[0] === 'task:create')
      expect(createCall, 'task:create not sent').to.exist
      const payload = createCall!.args[1] as {content: string; type: string}
      expect(payload.type).to.equal('record-answer')

      const decoded = JSON.parse(payload.content) as {answer: string; fingerprint: string; query: string}
      expect(decoded.query).to.equal('how does auth work')
      expect(decoded.answer).to.equal('Auth uses JWTs')
      expect(decoded.fingerprint).to.equal('fp-1')
    })
  })

  describe('output formats', () => {
    it('text format reports the recorded status', async () => {
      await createCommand('q', 'a', '--fingerprint', 'fp-1').run()

      const joined = loggedMessages.join('\n').toLowerCase()
      expect(joined).to.match(/recorded|cached|fingerprint/)
    })

    it('json format passes the daemon payload through', async () => {
      await createJsonCommand('q', 'a', '--fingerprint', 'fp-1').run()

      const out = stdoutOutput.join('').trim()
      const parsed = JSON.parse(out) as {command: string; data: {fingerprint: string; recorded: boolean}; success: boolean}
      expect(parsed.command).to.equal('record-answer')
      expect(parsed.success).to.equal(true)
      expect(parsed.data.recorded).to.equal(true)
      expect(parsed.data.fingerprint).to.equal('fp-1')
    })
  })
})
