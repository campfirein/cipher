import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonFakeTimers, type SinonStub, stub, useFakeTimers} from 'sinon'

import type {McpStartupProjectContext} from '../../../../../src/server/infra/mcp/tools/mcp-project-context.js'

import {BrvQueryInputSchema, registerBrvQueryTool} from '../../../../../src/server/infra/mcp/tools/brv-query-tool.js'

/** Attribution footer produced by QueryExecutor — included in task:completed result */
const ATTRIBUTION_FOOTER = '\n\n---\nSource: ByteRover Knowledge Base'

/** Returns undefined — named constant avoids inline `() => undefined` triggering unicorn/no-useless-undefined. */
const noClient = (): ITransportClient | undefined => undefined
const noWorkingDirectory = (): string | undefined => undefined

/**
 * Handler type captured from server.registerTool().
 */
type QueryToolHandler = (input: {cwd?: string; query: string}) => Promise<{
  content: Array<{text: string; type: string}>
  isError?: boolean
}>

/**
 * Creates a mock McpServer that captures tool handlers on registerTool().
 */
function createMockMcpServer(): {
  getHandler: (name: string) => QueryToolHandler
  server: McpServer
} {
  const handlers = new Map<string, QueryToolHandler>()

  const mock = {
    registerTool(name: string, _config: unknown, cb: QueryToolHandler) {
      handlers.set(name, cb)
    },
  }

  return {
    getHandler(name: string): QueryToolHandler {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`Handler ${name} not registered`)
      return handler
    },
    server: mock as unknown as McpServer,
  }
}

/**
 * Creates a mock transport client for testing.
 */
function createMockClient(options?: {state?: ConnectionState}): {
  client: ITransportClient
  simulateEvent: <T>(event: string, payload: T) => void
  simulateStateChange: (state: ConnectionState) => void
} {
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>()
  const stateHandlers = new Set<ConnectionStateHandler>()

  const client: ITransportClient = {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mock-client-id'),
    getDaemonVersion: stub(),
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
      return () => {
        stateHandlers.delete(handler)
      }
    },
    request: stub() as unknown as ITransportClient['request'],
    requestWithAck: stub().resolves(),
  }

  return {
    client,
    simulateEvent<T>(event: string, payload: T) {
      const handlers = eventHandlers.get(event)
      if (handlers) {
        for (const handler of handlers) {
          handler(payload)
        }
      }
    },
    simulateStateChange(state: ConnectionState) {
      for (const handler of stateHandlers) {
        handler(state)
      }
    },
  }
}

/**
 * Registers the brv-query tool on a mock McpServer and returns the captured handler.
 */
function setupQueryHandler(options: {
  getClient: () => ITransportClient | undefined
  getStartupProjectContext?: () => McpStartupProjectContext | undefined
  getWorkingDirectory: () => string | undefined
}): QueryToolHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvQueryTool(
    server,
    options.getClient,
    options.getWorkingDirectory,
    options.getStartupProjectContext ??
      (() => {
        const workingDirectory = options.getWorkingDirectory()
        return workingDirectory
          ? {projectRoot: workingDirectory, worktreeRoot: workingDirectory}
          : undefined
      }),
    'test-client-version',
  )
  return getHandler('brv-query')
}

describe('brv-query-tool', () => {
  afterEach(() => {
    restore()
  })

  describe('BrvQueryInputSchema', () => {
    it('should accept query without cwd', () => {
      const result = BrvQueryInputSchema.safeParse({query: 'How is auth implemented?'})
      expect(result.success).to.be.true
    })

    it('should accept query with cwd', () => {
      const result = BrvQueryInputSchema.safeParse({
        cwd: '/path/to/project',
        query: 'How is auth implemented?',
      })
      expect(result.success).to.be.true
    })

    it('should reject missing query', () => {
      const result = BrvQueryInputSchema.safeParse({cwd: '/path'})
      expect(result.success).to.be.false
    })

    it('should accept optional cwd as undefined', () => {
      const result = BrvQueryInputSchema.safeParse({query: 'test'})
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.data.cwd).to.be.undefined
      }
    })

    it('should expose cwd and query in the schema shape', () => {
      const {shape} = BrvQueryInputSchema
      expect(shape).to.have.property('cwd')
      expect(shape).to.have.property('query')
    })
  })

  describe('handler — project mode', () => {
    it('should use projectRoot as clientCwd when cwd is not provided', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        simulateEvent('task:completed', {result: 'Query answer', taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'How does auth work?'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal('Query answer')

      // Verify task:create payload
      const payload = requestStub.firstCall.args[1]
      expect(payload.clientCwd).to.equal('/project/root')
      expect(payload.type).to.equal('query')
      expect(payload.content).to.equal('How does auth work?')
      expect(payload.taskId).to.be.a('string')
    })

    it('should prefer explicit cwd over projectRoot', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-query-project-'))
      const otherProject = mkdtempSync(join(tmpdir(), 'brv-query-other-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      mkdirSync(join(otherProject, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      writeFileSync(join(otherProject, '.brv', 'config.json'), '{}')
      const canonicalOtherProject = realpathSync(otherProject)

      try {
        const {client, simulateEvent} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        requestStub.callsFake((_event: string, data: {taskId: string}) => {
          simulateEvent('task:completed', {result: 'ok', taskId: data.taskId})
          return Promise.resolve()
        })

        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: () => projectRoot,
        })

        await handler({cwd: otherProject, query: 'test'})

        const payload = requestStub.firstCall.args[1]
        expect(payload.clientCwd).to.equal(otherProject)
        expect(payload.projectPath).to.equal(canonicalOtherProject)
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
        rmSync(otherProject, {force: true, recursive: true})
      }
    })
  })

  describe('handler — global mode', () => {
    it('should return error when cwd is not provided and no working directory', async () => {
      const handler = setupQueryHandler({
        getClient: () => createMockClient().client,
        getWorkingDirectory: noWorkingDirectory,
      })

      const result = await handler({query: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('cwd parameter is required')
      expect(result.content[0].text).to.include('global mode')
    })

    it('should use explicit cwd when provided in global mode', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-query-global-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      const canonicalProjectRoot = realpathSync(projectRoot)

      try {
        const {client, simulateEvent} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        requestStub.callsFake((event: string, data: {taskId?: string}) => {
          if (event === 'task:create' && data.taskId) {
            simulateEvent('task:completed', {result: 'answer', taskId: data.taskId})
          }

          return Promise.resolve()
        })

        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const result = await handler({cwd: projectRoot, query: 'test'})

        expect(result.isError).to.be.undefined
        expect(result.content[0].text).to.equal('answer')

        const createCall = requestStub.getCalls().find((c: {args: unknown[]}) => c.args[0] === 'task:create')
        expect(createCall).to.exist
        expect(createCall!.args[1]).to.have.property('clientCwd', projectRoot)
        expect(createCall!.args[1]).to.have.property('projectPath', canonicalProjectRoot)
        expect(createCall!.args[1]).to.have.property('worktreeRoot', canonicalProjectRoot)
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should call client:associateProject with walked-up project root in global mode', async () => {
      // Create temp project with .brv/config.json so resolveProject finds the root
      const rawProjectRoot = mkdtempSync(join(tmpdir(), 'brv-test-'))
      const projectRoot = realpathSync(rawProjectRoot)
      const subDir = join(projectRoot, 'src', 'modules')
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      mkdirSync(subDir, {recursive: true})

      try {
        const {client, simulateEvent} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        requestStub.callsFake((event: string, data: {taskId?: string}) => {
          if (event === 'task:create' && data.taskId) {
            simulateEvent('task:completed', {result: 'ok', taskId: data.taskId})
          }

          return Promise.resolve()
        })

        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        // Pass subdirectory as cwd — associate_project should walk up to project root
        await handler({cwd: subDir, query: 'test'})

        const associateCall = requestStub
          .getCalls()
          .find((c: {args: unknown[]}) => c.args[0] === 'client:associateProject')
        expect(associateCall).to.exist
        expect(associateCall!.args[1]).to.deep.equal({projectPath: projectRoot})
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should not call client:associateProject in project mode', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId?: string}) => {
        if (data.taskId) {
          simulateEvent('task:completed', {result: 'ok', taskId: data.taskId})
        }

        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({query: 'test'})

      const associateCall = requestStub
        .getCalls()
        .find((c: {args: unknown[]}) => c.args[0] === 'client:associateProject')
      expect(associateCall).to.be.undefined
    })
  })

  describe('handler — client errors', () => {
    let clock: SinonFakeTimers

    beforeEach(() => {
      clock = useFakeTimers()
    })

    afterEach(() => {
      clock.restore()
    })

    it('should return error after timeout when client is undefined', async () => {
      const handler = setupQueryHandler({
        getClient: noClient,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({query: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should return error after timeout when client is disconnected', async () => {
      const {client} = createMockClient({state: 'disconnected'})

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({query: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should return error after timeout when client is in reconnecting state', async () => {
      const {client} = createMockClient({state: 'reconnecting'})

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({query: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should resolve immediately when client becomes connected during wait', async () => {
      const {client, simulateEvent} = createMockClient({state: 'reconnecting'})
      const currentClient = client

      const handler = setupQueryHandler({
        getClient: () => currentClient,
        getWorkingDirectory: () => '/project/root',
      })

      // Simulate requestWithAck completing task:create
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        simulateEvent('task:completed', {result: 'recovered answer', taskId: data.taskId})
        return Promise.resolve()
      })

      const resultPromise = handler({query: 'test'})

      // After 2s, client reconnects (getState now returns 'connected')
      await clock.tickAsync(2000)
      ;(client.getState as SinonStub).returns('connected')
      await clock.tickAsync(1000)

      const result = await resultPromise

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal('recovered answer')
    })
  })

  describe('handler — transport errors', () => {
    it('should retry project association once before creating the task', async () => {
      const clock = useFakeTimers()
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-query-retry-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')

      try {
        const {client, simulateEvent} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        let associationAttempts = 0

        requestStub.callsFake((event: string, data: {taskId?: string}) => {
          if (event === 'client:associateProject') {
            associationAttempts++
            if (associationAttempts === 1) {
              return new Promise(() => {})
            }

            return Promise.resolve({success: true})
          }

          if (event === 'task:create' && data.taskId) {
            simulateEvent('task:completed', {result: 'retried answer', taskId: data.taskId})
          }

          return Promise.resolve()
        })

        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const resultPromise = handler({cwd: projectRoot, query: 'test'})
        await clock.tickAsync(3001)
        const result = await resultPromise

        expect(result.isError).to.be.undefined
        expect(result.content[0].text).to.equal('retried answer')
        expect(associationAttempts).to.equal(2)
      } finally {
        clock.restore()
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should return actionable error when project association fails twice', async () => {
      const clock = useFakeTimers()
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-query-assoc-fail-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        requestStub.callsFake((event: string) => {
          if (event === 'client:associateProject') {
            return new Promise(() => {})
          }

          return Promise.resolve()
        })

        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const resultPromise = handler({cwd: projectRoot, query: 'test'})
        await clock.tickAsync(6002)
        const result = await resultPromise

        expect(result.isError).to.be.true
        expect(result.content[0].text).to.include('Failed to associate MCP client with project')
        expect(requestStub.getCalls().filter((c: {args: unknown[]}) => c.args[0] === 'task:create')).to.have.length(0)
      } finally {
        clock.restore()
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should surface resolver errors instead of silently falling back', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-query-broken-link-'))
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      writeFileSync(join(workspace, '.brv'), JSON.stringify({projectRoot: '/missing/project'}))

      try {
        const {client} = createMockClient()
        const handler = setupQueryHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const result = await handler({cwd: workspace, query: 'test'})

        expect(result.isError).to.be.true
        expect(result.content[0].text).to.include('Worktree pointer broken')
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should return error when requestWithAck rejects', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.rejects(new Error('Connection refused'))

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Connection refused')
    })

    it('should return error when task fails with error event', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        simulateEvent('task:error', {
          error: {message: 'File not found', name: 'TaskError'},
          taskId: data.taskId,
        })
        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('File not found')
    })
  })

  describe('handler — attribution', () => {
    it('should pass through attribution footer produced by executor', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      // Simulate executor returning result already containing the attribution footer
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        simulateEvent('task:completed', {result: 'Some knowledge content' + ATTRIBUTION_FOOTER, taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'test'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('Source: ByteRover Knowledge Base')
      expect(result.content[0].text).to.match(/Some knowledge content\n\n---\nSource: ByteRover Knowledge Base$/)
    })

    it('should not append attribution footer to error responses', async () => {
      const {client, simulateEvent} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        simulateEvent('task:error', {
          error: {message: 'Something failed', name: 'TaskError'},
          taskId: data.taskId,
        })
        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.not.include('Source: ByteRover Knowledge Base')
    })
  })

  describe('handler — event listener ordering', () => {
    it('should register event listeners before sending task:create (race condition prevention)', async () => {
      const {client, simulateEvent} = createMockClient()
      let listenersRegisteredBeforeCreate = false

      const requestStub = client.requestWithAck as SinonStub
      requestStub.callsFake((_event: string, data: {taskId: string}) => {
        // At this point, listeners should already be registered by waitForTaskResult.
        // Verify by checking that simulating task:completed resolves the handler.
        listenersRegisteredBeforeCreate = true
        simulateEvent('task:completed', {result: 'fast result', taskId: data.taskId})
        return Promise.resolve()
      })

      const handler = setupQueryHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({query: 'test'})

      expect(listenersRegisteredBeforeCreate).to.be.true
      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.equal('fast result')
    })
  })
})
