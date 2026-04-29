/* eslint-disable camelcase -- DESIGN §6.2 specifies snake_case for the gather payload */
/**
 * brv-gather MCP tool tests (Phase 5 Task 5.3).
 *
 * Verifies:
 *  - Schema accepts {cwd, query, scope?, limit?, token_budget?}
 *  - Handler routes through transport with task type 'gather'
 *  - Handler returns the JSON-stringified GatherResult as a single text block
 *  - Error paths return isError: true
 */

import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import type {McpStartupProjectContext} from '../../../../../src/server/infra/mcp/tools/mcp-project-context.js'

import {BrvGatherInputSchema, registerBrvGatherTool} from '../../../../../src/server/infra/mcp/tools/brv-gather-tool.js'

type GatherToolHandler = (input: {
  cwd?: string
  limit?: number
  query: string
  scope?: string
  token_budget?: number
}) => Promise<{content: Array<{text: string; type: string}>; isError?: boolean}>

function createMockMcpServer(): {getHandler: (name: string) => GatherToolHandler; server: McpServer} {
  const handlers = new Map<string, GatherToolHandler>()
  const mock = {
    registerTool(name: string, _config: unknown, cb: GatherToolHandler) {
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
}): GatherToolHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvGatherTool(
    server,
    options.getClient,
    options.getWorkingDirectory,
    options.getStartupProjectContext ??
      (() => {
        const wd = options.getWorkingDirectory()
        return wd ? {projectRoot: wd, worktreeRoot: wd} : undefined
      }),
  )
  return getHandler('brv-gather')
}

describe('brv-gather-tool', () => {
  afterEach(() => restore())

  describe('BrvGatherInputSchema', () => {
    it('accepts {query} only', () => {
      expect(BrvGatherInputSchema.safeParse({query: 'auth'}).success).to.equal(true)
    })

    it('accepts all optional fields including token_budget', () => {
      const r = BrvGatherInputSchema.safeParse({
        cwd: '/p',
        limit: 25,
        query: 'auth',
        scope: 'src/auth',
        token_budget: 8000,
      })
      expect(r.success).to.equal(true)
    })

    it('rejects missing query', () => {
      expect(BrvGatherInputSchema.safeParse({cwd: '/p'}).success).to.equal(false)
    })

    it('rejects token_budget below 100 (sub-payload size)', () => {
      expect(BrvGatherInputSchema.safeParse({query: 'auth', token_budget: 50}).success).to.equal(false)
    })

    it('rejects limit > 50', () => {
      expect(BrvGatherInputSchema.safeParse({limit: 100, query: 'auth'}).success).to.equal(false)
    })
  })

  describe('handler — task routing', () => {
    it('sends task:create with type "gather"', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      const samplePayload = JSON.stringify({
        prefetched_context: 'JWT info',
        search_metadata: {result_count: 1, top_score: 0.9, total_found: 1},
        total_tokens_estimated: 25,
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
      expect(payload.type).to.equal('gather')
    })

    it('encodes scope, limit, and token_budget into the content payload', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) {
          simulateEvent('task:completed', {
            result: JSON.stringify({
              prefetched_context: '',
              search_metadata: {result_count: 0, top_score: 0, total_found: 0},
              total_tokens_estimated: 0,
            }),
            taskId: data.taskId,
          })
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      await handler({limit: 20, query: 'jwt', scope: 'src/auth', token_budget: 6000})

      const createCall = requestStub
        .getCalls()
        .find((c: {args: unknown[]}) => c.args[0] === 'task:create')
      const {content} = createCall!.args[1] as {content: string}
      const decoded = JSON.parse(content) as {limit?: number; query: string; scope?: string; tokenBudget?: number}
      expect(decoded.query).to.equal('jwt')
      expect(decoded.scope).to.equal('src/auth')
      expect(decoded.limit).to.equal(20)
      expect(decoded.tokenBudget).to.equal(6000)
    })

    it('returns the daemon result verbatim as content[0].text (JSON-encoded GatherResult)', async () => {
      const samplePayload = JSON.stringify({
        follow_up_hints: ['few results'],
        prefetched_context: '### JWT\n**Source**: .brv/context-tree/auth.md\n\nJWT info',
        search_metadata: {result_count: 1, top_score: 0.95, total_found: 1},
        total_tokens_estimated: 30,
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
      const parsed = JSON.parse(result.content[0].text) as {prefetched_context: string}
      expect(parsed.prefetched_context).to.include('JWT')
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
          simulateEvent('task:error', {error: {message: 'Index missing', name: 'TaskError'}, taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupHandler({getClient: () => client, getWorkingDirectory: () => '/proj'})
      const result = await handler({query: 'auth'})

      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.include('Index missing')
    })
  })
})
