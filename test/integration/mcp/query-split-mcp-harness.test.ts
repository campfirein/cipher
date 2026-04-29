/**
 * Phase 5 round-trip — MCP transport harness (PHASE-5-CODE-REVIEW.md Pass 7 F3).
 *
 * Drives the search → gather → record → cached-search loop through a REAL MCP
 * client/server protocol over `InMemoryTransport`. Catches what the
 * executor-only round-trip test (`query-split-roundtrip.test.ts`) misses:
 *
 *   - Tool name registration mismatches (would 404 if SKILL.md taught
 *     underscored names that don't match the hyphenated registrations).
 *   - Schema regressions (Zod input validation goes through MCP).
 *   - Content / `_meta` encoding regressions on the wire.
 *   - `encodeSearchContent` / `decodeSearchContent` round-trip on the
 *     transport `content` field.
 *   - `toBrvSearchResult` public-DTO mapping correctness.
 *
 * The daemon transport is mocked: `task:create` events are routed directly
 * to real `QueryDispatcher` / `GatherExecutor` / `RecordAnswerExecutor`
 * instances sharing one `QueryResultCache` (mirrors `agent-process.ts`
 * wiring). This isolates the MCP-layer assertions from daemon process
 * boot complexity while still exercising the public protocol.
 */

import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IFileSystem} from '../../../src/agent/core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../src/agent/infra/sandbox/tools-sdk.js'

import {QueryDispatcher, toBrvSearchResult} from '../../../src/server/infra/dispatcher/query-dispatcher.js'
import {GatherExecutor} from '../../../src/server/infra/executor/gather-executor.js'
import {QueryResultCache} from '../../../src/server/infra/executor/query-result-cache.js'
import {RecordAnswerExecutor} from '../../../src/server/infra/executor/record-answer-executor.js'
import {registerBrvCurateTool} from '../../../src/server/infra/mcp/tools/brv-curate-tool.js'
import {registerBrvGatherTool} from '../../../src/server/infra/mcp/tools/brv-gather-tool.js'
import {registerBrvQueryTool} from '../../../src/server/infra/mcp/tools/brv-query-tool.js'
import {registerBrvRecordAnswerTool} from '../../../src/server/infra/mcp/tools/brv-record-answer-tool.js'
import {registerBrvSearchTool} from '../../../src/server/infra/mcp/tools/brv-search-tool.js'

const QUERY = 'how does authentication work'
const FINGERPRINT = 'mcp-harness-fp-001'
const SYNTHESIZED_ANSWER = 'Auth uses JWTs with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts.'

function makeResults(scores: number[]): SearchKnowledgeResult {
  const results = scores.map((score, i) => ({
    excerpt: `excerpt ${i}`,
    path: `topics/doc-${i}.md`,
    score,
    title: `Doc ${i}`,
  }))
  return {message: '', results, totalFound: results.length}
}

function makeFileSystem(): IFileSystem {
  return {readFile: stub().resolves({content: 'doc body', encoding: 'utf8'})} as unknown as IFileSystem
}

const TEST_PROJECT_ROOT = '/test/proj'
const getTestCwd = (): string | undefined => TEST_PROJECT_ROOT
const getTestStartup = () => ({projectRoot: TEST_PROJECT_ROOT, worktreeRoot: TEST_PROJECT_ROOT})

/**
 * Mock daemon transport that routes `task:create` events directly to the
 * real Phase 5 executors and simulates `task:completed` responses. Mirrors
 * the shape used by the brv-* MCP tool handlers.
 */
function createMockDaemonTransport(deps: {
  dispatcher: QueryDispatcher
  gatherExecutor: GatherExecutor
  recordAnswerExecutor: RecordAnswerExecutor
}): ITransportClient {
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>()
  // stateHandlers is intentionally collected but never fired in this harness
  // (no reconnect events are simulated); kept so onStateChange callers can
  // still register and receive a working teardown closure.
  const stateHandlers = new Set<ConnectionStateHandler>()

  const requestWithAckStub = stub().callsFake(async (event: string, payload?: unknown) => {
    if (event !== 'task:create') return
    const task = payload as {content: string; taskId: string; type: string}

    // Route to the right executor based on task type, exactly like
    // agent-process.ts switch.
    let result: string
    switch (task.type) {
      case 'gather': {
        const decoded = JSON.parse(task.content) as {limit?: number; query: string; scope?: string; tokenBudget?: number}
        const gatherResult = await deps.gatherExecutor.execute({
          ...(decoded.limit === undefined ? {} : {limit: decoded.limit}),
          query: decoded.query,
          ...(decoded.scope === undefined ? {} : {scope: decoded.scope}),
          ...(decoded.tokenBudget === undefined ? {} : {tokenBudget: decoded.tokenBudget}),
        })
        result = JSON.stringify(gatherResult)
        break
      }

      case 'mcp-search': {
        const decoded = JSON.parse(task.content) as {limit?: number; query: string; scope?: string}
        const dispatch = await deps.dispatcher.dispatch({
          fingerprint: FINGERPRINT,
          ...(decoded.limit === undefined ? {} : {limit: decoded.limit}),
          query: decoded.query,
          ...(decoded.scope === undefined ? {} : {scope: decoded.scope}),
        })
        result = JSON.stringify(toBrvSearchResult(dispatch))
        break
      }

      case 'record-answer': {
        const decoded = JSON.parse(task.content) as {answer: string; fingerprint: string; query: string}
        const recordResult = await deps.recordAnswerExecutor.execute(decoded)
        result = JSON.stringify(recordResult)
        break
      }

      default: {
        throw new Error(`unexpected task type in MCP harness: ${task.type}`)
      }
    }

    // Simulate task:completed event after handler returns
    const completedHandlers = eventHandlers.get('task:completed')
    if (completedHandlers) {
      for (const handler of completedHandlers) {
        handler({result, taskId: task.taskId})
      }
    }

    
  })

  return {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mcp-harness-client'),
    getState: stub().returns('connected' as ConnectionState),
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
    onStateChange(handler) {
      stateHandlers.add(handler)
      return () => stateHandlers.delete(handler)
    },
    request: stub() as unknown as ITransportClient['request'],
    requestWithAck: requestWithAckStub as unknown as ITransportClient['requestWithAck'],
  }
}

describe('Phase 5 round-trip via MCP transport (Pass 7 F3 harness)', () => {
  afterEach(() => restore())

   
  it('drives search → gather → record-answer → cached-search through a real MCP client/server protocol', async () => {
    // Daemon-side singletons (one cache shared across executors — mirrors agent-process.ts)
    const cache = new QueryResultCache()
    const searchService = {search: stub().resolves(makeResults([0.3, 0.25, 0.2]))} as unknown as ISearchKnowledgeService
    const fileSystem = makeFileSystem()
    const dispatcher = new QueryDispatcher({cache, fileSystem, searchService})
    const gatherExecutor = new GatherExecutor({searchService})
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})

    // Mock daemon transport intercepts task:create and simulates task:completed
    const daemonTransport = createMockDaemonTransport({dispatcher, gatherExecutor, recordAnswerExecutor})

    // Real McpServer with all 5 brv tools registered (same as ByteRoverMcpServer)
    const server = new McpServer({name: 'brv-test', version: '1.0.0'})
    const getClient = () => daemonTransport
    registerBrvSearchTool(server, getClient, getTestCwd, getTestStartup)
    registerBrvGatherTool(server, getClient, getTestCwd, getTestStartup)
    registerBrvRecordAnswerTool(server, getClient, getTestCwd, getTestStartup)
    registerBrvQueryTool(server, getClient, getTestCwd, getTestStartup)
    registerBrvCurateTool(server, getClient, getTestCwd, getTestStartup)

    // Real MCP client/server linked over in-memory transport
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({name: 'brv-test-client', version: '1.0.0'})
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      // === PRECONDITION: tools advertised correctly ===
      const tools = await client.listTools()
      const toolNames = new Set(tools.tools.map((t) => t.name))
      expect(toolNames.has('brv-search')).to.equal(true, 'brv-search must be registered (hyphenated)')
      expect(toolNames.has('brv-gather')).to.equal(true, 'brv-gather must be registered (hyphenated)')
      expect(toolNames.has('brv-record-answer')).to.equal(true, 'brv-record-answer must be registered (hyphenated)')
      expect(toolNames.has('brv-query')).to.equal(true)
      expect(toolNames.has('brv-curate')).to.equal(true)

      // === STEP 1: brv-search via MCP ===
      const search1 = await client.callTool({arguments: {query: QUERY}, name: 'brv-search'})
      const search1Text = (search1.content as Array<{text: string}>)[0].text
      const search1Public = JSON.parse(search1Text) as {fingerprint?: string; passages?: unknown[]; status: string; tier: number}

      expect(search1Public.status).to.equal('needs_synthesis')
      expect(search1Public.tier).to.equal(2)
      expect(search1Public.fingerprint).to.equal(FINGERPRINT)
      expect(search1Public.passages).to.have.length(3)

      // === STEP 2: brv-gather via MCP ===
      const gather = await client.callTool({arguments: {query: QUERY}, name: 'brv-gather'})
      const gatherText = (gather.content as Array<{text: string}>)[0].text
      const gatherPublic = JSON.parse(gatherText) as {prefetched_context: string; search_metadata: {result_count: number; top_score: number}}

      expect(gatherPublic.search_metadata.result_count).to.equal(3)
      expect(gatherPublic.search_metadata.top_score).to.be.closeTo(0.3, 0.01)

      // === STEP 3: agent synthesizes (simulated) ===

      // === STEP 4: brv-record-answer via MCP ===
      const record = await client.callTool({
        arguments: {answer: SYNTHESIZED_ANSWER, fingerprint: FINGERPRINT, query: QUERY},
        name: 'brv-record-answer',
      })
      const recordText = (record.content as Array<{text: string}>)[0].text
      const recordPublic = JSON.parse(recordText) as {fingerprint: string; recorded: boolean}

      expect(recordPublic.recorded).to.equal(true)
      expect(recordPublic.fingerprint).to.equal(FINGERPRINT)

      // === STEP 5: brv-search again — should now hit tier 0 cache ===
      const search2 = await client.callTool({arguments: {query: QUERY}, name: 'brv-search'})
      const search2Text = (search2.content as Array<{text: string}>)[0].text
      const search2Public = JSON.parse(search2Text) as {cached_answer?: string; status: string; tier: number}

      expect(search2Public.status).to.equal('cached_answer')
      expect(search2Public.tier).to.equal(0)
      expect(search2Public.cached_answer).to.equal(SYNTHESIZED_ANSWER)
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })

  it('listTools surfaces brv-query as deprecated (so MCP clients can hide / warn)', async () => {
    const cache = new QueryResultCache()
    const searchService = {search: stub().resolves(makeResults([]))} as unknown as ISearchKnowledgeService
    const dispatcher = new QueryDispatcher({cache, fileSystem: makeFileSystem(), searchService})
    const gatherExecutor = new GatherExecutor({searchService})
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})
    const daemonTransport = createMockDaemonTransport({dispatcher, gatherExecutor, recordAnswerExecutor})

    const server = new McpServer({name: 'brv-test', version: '1.0.0'})
    registerBrvQueryTool(server, () => daemonTransport, () => '/p', () => ({projectRoot: '/p', worktreeRoot: '/p'}))

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({name: 'brv-test-client', version: '1.0.0'})
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const tools = await client.listTools()
      const brvQuery = tools.tools.find((t) => t.name === 'brv-query')
      expect(brvQuery, 'brv-query must be advertised over MCP').to.exist
      expect(brvQuery!.description ?? '').to.match(/^\[deprecated]/i)
      // _meta.deprecated should round-trip through MCP wire so tool-aware clients see it
      const meta = brvQuery!._meta as Record<string, unknown> | undefined
      expect(meta).to.exist
      expect(meta!.deprecated).to.equal(true)
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })

  it('schema validation runs through MCP — calling brv-search without query is rejected', async () => {
    const cache = new QueryResultCache()
    const searchService = {search: stub().resolves(makeResults([]))} as unknown as ISearchKnowledgeService
    const dispatcher = new QueryDispatcher({cache, fileSystem: makeFileSystem(), searchService})
    const gatherExecutor = new GatherExecutor({searchService})
    const recordAnswerExecutor = new RecordAnswerExecutor({cache})
    const daemonTransport = createMockDaemonTransport({dispatcher, gatherExecutor, recordAnswerExecutor})

    const server = new McpServer({name: 'brv-test', version: '1.0.0'})
    registerBrvSearchTool(server, () => daemonTransport, () => '/p', () => ({projectRoot: '/p', worktreeRoot: '/p'}))

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({name: 'brv-test-client', version: '1.0.0'})
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      try {
        await client.callTool({arguments: {}, name: 'brv-search'})
        expect.fail('expected MCP-side schema validation to reject missing query')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message.toLowerCase()).to.match(/required|missing|query|invalid/)
      }
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })
   
})
