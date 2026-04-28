/**
 * brv-search MCP tool tests (Phase 5 Task 5.2).
 *
 * Verifies:
 *  - Schema accepts {cwd, query, scope?, limit?}
 *  - Handler routes through transport with task type 'mcp-search' (NOT 'search';
 *    that's the existing CLI BM25 task)
 *  - Handler returns the JSON-stringified DispatchResult as a single text block
 *  - Error paths (no daemon, transport reject, task error) return isError: true
 *
 * Daemon-side dispatch (agent-process.ts 'mcp-search' case → QueryDispatcher)
 * is exercised by the round-trip integration test (PHASE-5-PLAN.md §2 #8),
 * not here — this file only covers the MCP tool surface.
 */

import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {McpStartupProjectContext} from '../../../../../src/server/infra/mcp/tools/mcp-project-context.js'

import {BrvSearchInputSchema, registerBrvSearchTool} from '../../../../../src/server/infra/mcp/tools/brv-search-tool.js'

type SearchToolHandler = (input: {
  cwd?: string
  limit?: number
  query: string
  scope?: string
}) => Promise<{
  _meta?: Record<string, unknown>
  content: Array<{text: string; type: string}>
  isError?: boolean
}>

function createMockMcpServer(): {
  getHandler: (name: string) => SearchToolHandler
  server: McpServer
} {
  const handlers = new Map<string, SearchToolHandler>()
  const mock = {
    registerTool(name: string, _config: unknown, cb: SearchToolHandler) {
      handlers.set(name, cb)
    },
  }
  return {
    getHandler(name: string): SearchToolHandler {
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
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set())
      }

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
      if (handlers) {
        for (const h of handlers) h(payload)
      }
    },
  }
}

function setupHandler(options: {
  getClient: () => ITransportClient | undefined
  getStartupProjectContext?: () => McpStartupProjectContext | undefined
  getWorkingDirectory: () => string | undefined
}): SearchToolHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvSearchTool(
    server,
    options.getClient,
    options.getWorkingDirectory,
    options.getStartupProjectContext ??
      (() => {
        const wd = options.getWorkingDirectory()
        return wd ? {projectRoot: wd, worktreeRoot: wd} : undefined
      }),
  )
  return getHandler('brv-search')
}

describe('brv-search-tool', () => {
  afterEach(() => {
    restore()
  })

  describe('BrvSearchInputSchema', () => {
    it('accepts {query} only', () => {
      const r = BrvSearchInputSchema.safeParse({query: 'auth'})
      expect(r.success).to.equal(true)
    })

    it('accepts all optional fields', () => {
      const r = BrvSearchInputSchema.safeParse({
        cwd: '/p',
        limit: 25,
        query: 'auth',
        scope: 'src/auth',
      })
      expect(r.success).to.equal(true)
    })

    it('rejects missing query', () => {
      const r = BrvSearchInputSchema.safeParse({cwd: '/p'})
      expect(r.success).to.equal(false)
    })

    it('rejects limit > 50 (DESIGN §6.1 cap)', () => {
      const r = BrvSearchInputSchema.safeParse({limit: 100, query: 'auth'})
      expect(r.success).to.equal(false)
    })

    it('rejects limit < 1', () => {
      const r = BrvSearchInputSchema.safeParse({limit: 0, query: 'auth'})
      expect(r.success).to.equal(false)
    })
  })

  describe('handler — task routing', () => {
    it('sends task:create with type "mcp-search" (NOT "search" — that is the CLI task)', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      const samplePayload = JSON.stringify({
        fingerprint: 'fp-1',
        passages: [],
        status: 'no_results',
        tier: 2,
        // eslint-disable-next-line camelcase -- public DTO is snake_case per DESIGN §6.1
        timing_ms: 5,
        // eslint-disable-next-line camelcase
        total_found: 0,
      })
      requestStub.callsFake((event: string, data: {taskId?: string}) => {
        if (event === 'task:create' && data.taskId) {
          simulateEvent('task:completed', {result: samplePayload, taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      await handler({query: 'auth'})

      const createCall = requestStub
        .getCalls()
        .find((c: {args: unknown[]}) => c.args[0] === 'task:create')
      expect(createCall).to.exist
      const payload = createCall!.args[1] as {content: string; type: string}
      expect(payload.type).to.equal('mcp-search')
    })

    it('encodes scope and limit into the content payload', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) {
          simulateEvent('task:completed', {
            // eslint-disable-next-line camelcase -- public DTO is snake_case per DESIGN §6.1
            result: JSON.stringify({passages: [], status: 'no_results', tier: 2, timing_ms: 1, total_found: 0}),
            taskId: data.taskId,
          })
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      await handler({limit: 20, query: 'jwt', scope: 'src/auth'})

      const createCall = requestStub
        .getCalls()
        .find((c: {args: unknown[]}) => c.args[0] === 'task:create')
      const {content} = (createCall!.args[1] as {content: string})
      const decoded = JSON.parse(content) as {limit?: number; query: string; scope?: string}
      expect(decoded.query).to.equal('jwt')
      expect(decoded.scope).to.equal('src/auth')
      expect(decoded.limit).to.equal(20)
    })

    it('returns the daemon result verbatim as content[0].text (JSON-encoded DispatchResult)', async () => {
      const samplePayload = JSON.stringify({
        fingerprint: 'fp-2',
        passages: [{excerpt: 'JWT details', path: 'auth.md', score: 0.95}],
        status: 'direct_passages',
        tier: 2,
        // eslint-disable-next-line camelcase -- public DTO is snake_case per DESIGN §6.1
        timing_ms: 50,
        // eslint-disable-next-line camelcase
        total_found: 1,
      })

      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) simulateEvent('task:completed', {result: samplePayload, taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal(samplePayload)
      // Sanity: the agent (consumer) can JSON.parse this back to a typed shape
      const parsed = JSON.parse(result.content[0].text) as {status: string}
      expect(parsed.status).to.equal('direct_passages')
    })
  })

  describe('handler — structured _meta (PHASE-5-CODE-REVIEW.md W2)', () => {
    it('returns the typed BrvSearchResult on the _meta channel for tool-aware clients', async () => {
      /* eslint-disable camelcase -- DESIGN §6.1 specifies snake_case for the public DTO */
      const samplePayloadObj = {
        fingerprint: 'fp-meta',
        passages: [{excerpt: 'JWT details', path: 'auth.md', score: 0.95}],
        status: 'direct_passages' as const,
        tier: 2 as const,
        timing_ms: 50,
        total_found: 1,
      }
      /* eslint-enable camelcase */
      const samplePayload = JSON.stringify(samplePayloadObj)

      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) simulateEvent('task:completed', {result: samplePayload, taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.be.undefined
      // Text content (legacy path) still present and identical
      expect(result.content[0].text).to.equal(samplePayload)
      // _meta channel mirrors the typed payload — no JSON re-parse needed by client
      expect(result._meta).to.exist
      expect(result._meta).to.deep.equal(samplePayloadObj)
    })

    it('omits _meta when daemon emits non-JSON (legacy / error fallback)', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) simulateEvent('task:completed', {result: 'plain string not json', taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal('plain string not json')
      // _meta is absent — non-JSON daemon output should not break legacy callers
      expect(result._meta).to.be.undefined
    })
  })

  describe('handler — error paths', () => {
    it('returns isError when daemon transport rejects', async () => {
      const {client} = createMockClient()
      ;(client.requestWithAck as SinonStub).rejects(new Error('Connection refused'))

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.include('Connection refused')
    })

    it('returns isError when task fails with task:error event', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) {
          simulateEvent('task:error', {error: {message: 'BM25 index missing', name: 'TaskError'}, taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.include('BM25 index missing')
    })
  })
})
