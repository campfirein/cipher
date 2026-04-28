/**
 * brv-record-answer MCP tool tests (Phase 5 Task 5.4).
 *
 * Verifies:
 *  - Schema requires {query, answer, fingerprint} (no defaults — write op)
 *  - Handler routes through transport with task type 'record-answer'
 *  - Handler returns the JSON-stringified RecordAnswerResult
 *  - Error paths return isError: true
 */

import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {McpStartupProjectContext} from '../../../../../src/server/infra/mcp/tools/mcp-project-context.js'

import {
  BrvRecordAnswerInputSchema,
  registerBrvRecordAnswerTool,
} from '../../../../../src/server/infra/mcp/tools/brv-record-answer-tool.js'

type RecordAnswerHandler = (input: {
  answer: string
  cwd?: string
  fingerprint: string
  query: string
}) => Promise<{content: Array<{text: string; type: string}>; isError?: boolean}>

function createMockMcpServer(): {getHandler: (name: string) => RecordAnswerHandler; server: McpServer} {
  const handlers = new Map<string, RecordAnswerHandler>()
  const mock = {
    registerTool(name: string, _config: unknown, cb: RecordAnswerHandler) {
      handlers.set(name, cb)
    },
  }
  return {
    getHandler(name: string) {
      const h = handlers.get(name)
      if (!h) throw new Error(`Handler ${name} not registered`)
      return h
    },
    server: mock as unknown as McpServer,
  }
}

function createMockClient(options?: {state?: ConnectionState}): {
  client: ITransportClient
  simulateEvent: <T>(event: string, payload: T) => void
} {
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>()
  const stateHandlers = new Set<ConnectionStateHandler>()

  const client: ITransportClient = {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mock-client-id'),
    getState: stub().returns(options?.state ?? 'connected'),
    isConnected: stub().resolves(true),
    joinRoom: stub().resolves(),
    leaveRoom: stub().resolves(),
    on<T>(event: string, handler: (data: T) => void) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, new Set())
      eventHandlers.get(event)!.add(handler as (data: unknown) => void)
      return () => {
        eventHandlers.get(event)?.delete(handler as (data: unknown) => void)
      }
    },
    once: stub(),
    onStateChange(handler: ConnectionStateHandler) {
      stateHandlers.add(handler)
      return () => stateHandlers.delete(handler)
    },
    request: stub() as unknown as ITransportClient['request'],
    requestWithAck: stub().resolves(),
  }

  return {
    client,
    simulateEvent<T>(event: string, payload: T) {
      const handlers = eventHandlers.get(event)
      if (handlers) for (const h of handlers) h(payload)
    },
  }
}

function setupHandler(options: {
  getClient: () => ITransportClient | undefined
  getStartupProjectContext?: () => McpStartupProjectContext | undefined
  getWorkingDirectory: () => string | undefined
}): RecordAnswerHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvRecordAnswerTool(
    server,
    options.getClient,
    options.getWorkingDirectory,
    options.getStartupProjectContext ??
      (() => {
        const wd = options.getWorkingDirectory()
        return wd ? {projectRoot: wd, worktreeRoot: wd} : undefined
      }),
  )
  return getHandler('brv-record-answer')
}

describe('brv-record-answer-tool', () => {
  afterEach(() => restore())

  describe('BrvRecordAnswerInputSchema', () => {
    it('accepts {query, answer, fingerprint}', () => {
      const r = BrvRecordAnswerInputSchema.safeParse({
        answer: 'Auth uses JWTs',
        fingerprint: 'fp-1',
        query: 'auth',
      })
      expect(r.success).to.equal(true)
    })

    it('rejects missing query', () => {
      const r = BrvRecordAnswerInputSchema.safeParse({answer: 'a', fingerprint: 'fp'})
      expect(r.success).to.equal(false)
    })

    it('rejects missing answer (the whole point of this tool)', () => {
      const r = BrvRecordAnswerInputSchema.safeParse({fingerprint: 'fp', query: 'q'})
      expect(r.success).to.equal(false)
    })

    it('rejects missing fingerprint (cache key required)', () => {
      const r = BrvRecordAnswerInputSchema.safeParse({answer: 'a', query: 'q'})
      expect(r.success).to.equal(false)
    })

    it('rejects empty fingerprint string', () => {
      const r = BrvRecordAnswerInputSchema.safeParse({answer: 'a', fingerprint: '', query: 'q'})
      expect(r.success).to.equal(false)
    })
  })

  describe('handler — task routing', () => {
    it('sends task:create with type "record-answer" and encoded payload', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      const samplePayload = JSON.stringify({fingerprint: 'fp-1', recorded: true})
      requestStub.callsFake((event: string, data: {taskId?: string}) => {
        if (event === 'task:create' && data.taskId) {
          simulateEvent('task:completed', {result: samplePayload, taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      await handler({answer: 'Auth uses JWTs', fingerprint: 'fp-1', query: 'auth'})

      const createCall = requestStub.getCalls().find((c: {args: unknown[]}) => c.args[0] === 'task:create')
      expect(createCall).to.exist
      const payload = createCall!.args[1] as {content: string; type: string}
      expect(payload.type).to.equal('record-answer')

      const decoded = JSON.parse(payload.content) as {answer: string; fingerprint: string; query: string}
      expect(decoded.query).to.equal('auth')
      expect(decoded.answer).to.equal('Auth uses JWTs')
      expect(decoded.fingerprint).to.equal('fp-1')
    })

    it('returns the daemon result verbatim as content[0].text (JSON-encoded RecordAnswerResult)', async () => {
      const samplePayload = JSON.stringify({fingerprint: 'fp-2', recorded: true})

      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) simulateEvent('task:completed', {result: samplePayload, taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({answer: 'A', fingerprint: 'fp-2', query: 'q'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal(samplePayload)
      const parsed = JSON.parse(result.content[0].text) as {recorded: boolean}
      expect(parsed.recorded).to.equal(true)
    })
  })

  describe('handler — error paths', () => {
    it('returns isError when daemon transport rejects', async () => {
      const {client} = createMockClient()
      ;(client.requestWithAck as SinonStub).rejects(new Error('Connection refused'))

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({answer: 'A', fingerprint: 'fp', query: 'q'})

      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.include('Connection refused')
    })

    it('returns isError when task fails with task:error event', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) {
          simulateEvent('task:error', {error: {message: 'Cache full', name: 'TaskError'}, taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({answer: 'A', fingerprint: 'fp', query: 'q'})

      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.include('Cache full')
    })
  })
})
