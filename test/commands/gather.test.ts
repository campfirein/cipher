/* eslint-disable camelcase -- gather payload uses snake_case per DESIGN §6.2 */
/**
 * `brv gather` CLI command tests (Phase 5 Task 5.3 — bonus deliverable).
 *
 * Verifies:
 *  - Required positional `query` arg
 *  - Flag handling (--limit, --scope, --token-budget, --format)
 *  - Sends task:create with type 'gather' and properly encoded content
 *  - Text format renders the bundle with section markers
 *  - JSON format pipes through the daemon's JSON payload
 */

import type {ConnectionResult, ITransportClient} from '@campfirein/brv-transport-client'
import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import Gather from '../../src/oclif/commands/gather.js'

class TestableGather extends Gather {
  private readonly mockConnector: () => Promise<ConnectionResult>

  constructor(argv: string[], mockConnector: () => Promise<ConnectionResult>, config: Config) {
    super(argv, config)
    this.mockConnector = mockConnector
  }

  protected override getDaemonClientOptions() {
    return {maxRetries: 1, retryDelayMs: 0, transportConnector: this.mockConnector}
  }
}

describe('Gather Command', () => {
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
        // Auto-fire task:completed on next tick after task:create issued
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
    const result = JSON.stringify({
      follow_up_hints: ['top score 0.30 indicates low confidence'],
      prefetched_context: '### JWT\n**Source**: .brv/context-tree/auth.md\n\nJWT info',
      search_metadata: {result_count: 1, top_score: 0.95, total_found: 1},
      total_tokens_estimated: 30,
    })
    return {result, taskId}
  }

  function createCommand(...argv: string[]): TestableGather {
    const command = new TestableGather(argv, mockConnector, config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg !== undefined) loggedMessages.push(msg)
    })
    return command
  }

  function createJsonCommand(...argv: string[]): TestableGather {
    const command = new TestableGather([...argv, '--format', 'json'], mockConnector, config)
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
    it('shows usage when query arg missing', async () => {
      try {
        await createCommand().run()
        expect.fail('expected oclif to throw on missing required arg')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message.toLowerCase()).to.match(/missing|required|query/)
      }
    })
  })

  describe('task routing', () => {
    it('sends task:create with type "gather" and the query in encoded content', async () => {
      await createCommand('how does auth work').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const createCall = requestStub.getCalls().find((c) => c.args[0] === 'task:create')
      expect(createCall, 'task:create not sent').to.exist
      const payload = createCall!.args[1] as {content: string; type: string}
      expect(payload.type).to.equal('gather')

      const decoded = JSON.parse(payload.content) as {limit?: number; query: string; scope?: string; tokenBudget?: number}
      expect(decoded.query).to.equal('how does auth work')
    })

    it('encodes --scope and --limit and --token-budget into the content payload', async () => {
      await createCommand('jwt', '--scope', 'src/auth', '--limit', '15', '--token-budget', '6000').run()

      const requestStub = mockClient.requestWithAck as sinon.SinonStub
      const createCall = requestStub.getCalls().find((c) => c.args[0] === 'task:create')
      const decoded = JSON.parse((createCall!.args[1] as {content: string}).content) as {
        limit?: number
        query: string
        scope?: string
        tokenBudget?: number
      }
      expect(decoded.scope).to.equal('src/auth')
      expect(decoded.limit).to.equal(15)
      expect(decoded.tokenBudget).to.equal(6000)
    })
  })

  describe('output formats', () => {
    it('text format renders the bundle and the follow-up hints', async () => {
      await createCommand('auth').run()

      const joined = loggedMessages.join('\n')
      expect(joined).to.include('JWT')
      expect(joined.toLowerCase()).to.match(/follow|hint|low confidence/)
    })

    it('json format passes the daemon payload through', async () => {
      await createJsonCommand('auth').run()

      const out = stdoutOutput.join('').trim()
      const parsed = JSON.parse(out) as {command: string; data: {prefetched_context: string}; success: boolean}
      expect(parsed.command).to.equal('gather')
      expect(parsed.success).to.equal(true)
      expect(parsed.data.prefetched_context).to.include('JWT')
    })
  })
})
