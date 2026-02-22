import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonFakeTimers, type SinonStub, stub, useFakeTimers} from 'sinon'

import {BrvCurateInputSchema, registerBrvCurateTool} from '../../../../../src/server/infra/mcp/tools/brv-curate-tool.js'

/** Returns undefined — named constant avoids inline `() => undefined` triggering unicorn/no-useless-undefined. */
const noClient = (): ITransportClient | undefined => undefined
const noWorkingDirectory = (): string | undefined => undefined

/**
 * Handler type captured from server.registerTool().
 */
type CurateToolHandler = (input: {context?: string; cwd?: string; files?: string[]}) => Promise<{
  content: Array<{text: string; type: string}>
  isError?: boolean
}>

/**
 * Creates a mock McpServer that captures tool handlers on registerTool().
 */
function createMockMcpServer(): {
  getHandler: (name: string) => CurateToolHandler
  server: McpServer
} {
  const handlers = new Map<string, CurateToolHandler>()

  const mock = {
    registerTool(name: string, _config: unknown, cb: CurateToolHandler) {
      handlers.set(name, cb)
    },
  }

  return {
    getHandler(name: string): CurateToolHandler {
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
 * Registers the brv-curate tool on a mock McpServer and returns the captured handler.
 */
function setupCurateHandler(options: {
  getClient: () => ITransportClient | undefined
  getWorkingDirectory: () => string | undefined
}): CurateToolHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvCurateTool(server, options.getClient, options.getWorkingDirectory)
  return getHandler('brv-curate')
}

describe('brv-curate-tool', () => {
  afterEach(() => {
    restore()
  })

  describe('BrvCurateInputSchema', () => {
    it('should accept context without cwd', () => {
      const result = BrvCurateInputSchema.safeParse({context: 'Auth uses JWT'})
      expect(result.success).to.be.true
    })

    it('should accept context with cwd', () => {
      const result = BrvCurateInputSchema.safeParse({
        context: 'Auth uses JWT',
        cwd: '/path/to/project',
      })
      expect(result.success).to.be.true
    })

    it('should accept files without cwd', () => {
      const result = BrvCurateInputSchema.safeParse({files: ['src/auth.ts']})
      expect(result.success).to.be.true
    })

    it('should accept files with cwd', () => {
      const result = BrvCurateInputSchema.safeParse({
        cwd: '/path/to/project',
        files: ['src/auth.ts'],
      })
      expect(result.success).to.be.true
    })

    it('should parse when neither context nor files provided (validation is in handler)', () => {
      const result = BrvCurateInputSchema.safeParse({cwd: '/path'})
      expect(result.success).to.be.true
    })

    it('should parse empty context with no files (validation is in handler)', () => {
      const result = BrvCurateInputSchema.safeParse({context: '   '})
      expect(result.success).to.be.true
    })

    it('should accept optional cwd as undefined', () => {
      const result = BrvCurateInputSchema.safeParse({context: 'test'})
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.data.cwd).to.be.undefined
      }
    })

    it('should enforce max 5 files', () => {
      const result = BrvCurateInputSchema.safeParse({
        files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      })
      expect(result.success).to.be.false
    })
  })

  describe('schema shape', () => {
    it('should expose cwd, context, and files in the input schema', () => {
      const {shape} = BrvCurateInputSchema
      expect(shape).to.have.property('cwd')
      expect(shape).to.have.property('context')
      expect(shape).to.have.property('files')
    })
  })

  describe('handler — project mode', () => {
    it('should use projectRoot as clientCwd when cwd is not provided', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'Auth uses JWT with 24h expiry'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('queued for curation')

      // Verify task:create payload
      const payload = requestStub.firstCall.args[1]
      expect(payload.clientCwd).to.equal('/project/root')
      expect(payload.type).to.equal('curate')
      expect(payload.content).to.equal('Auth uses JWT with 24h expiry')
      expect(payload.taskId).to.be.a('string')
    })

    it('should prefer explicit cwd over projectRoot', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({context: 'test', cwd: '/other/project'})

      const payload = requestStub.firstCall.args[1]
      expect(payload.clientCwd).to.equal('/other/project')
    })

    it('should include files in task:create payload when provided', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({context: 'Auth implementation', files: ['src/auth.ts', 'src/middleware.ts']})

      const payload = requestStub.firstCall.args[1]
      expect(payload.files).to.deep.equal(['src/auth.ts', 'src/middleware.ts'])
    })

    it('should not include files field when no files provided', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({context: 'Some context'})

      const payload = requestStub.firstCall.args[1]
      expect(payload.files).to.be.undefined
    })

    it('should use empty content when only files provided', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({files: ['src/auth.ts']})

      const payload = requestStub.firstCall.args[1]
      expect(payload.content).to.equal('')
      expect(payload.files).to.deep.equal(['src/auth.ts'])
    })
  })

  describe('handler — global mode', () => {
    it('should return error when cwd is not provided and no working directory', async () => {
      const handler = setupCurateHandler({
        getClient: () => createMockClient().client,
        getWorkingDirectory: noWorkingDirectory,
      })

      const result = await handler({context: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('cwd parameter is required')
      expect(result.content[0].text).to.include('global mode')
    })

    it('should use explicit cwd when provided in global mode', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: noWorkingDirectory,
      })

      const result = await handler({context: 'Auth pattern', cwd: '/some/project'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('queued for curation')

      const createCall = requestStub.getCalls().find((c: {args: unknown[]}) => c.args[0] === 'task:create')
      expect(createCall).to.exist
      expect(createCall!.args[1]).to.have.property('clientCwd', '/some/project')
    })

    it('should call client:associateProject with walked-up project root in global mode', async () => {
      // Create temp project with .brv/config.json so detectMcpMode finds the root
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-test-'))
      const subDir = join(projectRoot, 'src', 'modules')
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      mkdirSync(subDir, {recursive: true})

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub

        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        // Pass subdirectory as cwd — associate_project should walk up to project root
        await handler({context: 'Auth pattern', cwd: subDir})

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
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      await handler({context: 'test'})

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
      const handler = setupCurateHandler({
        getClient: noClient,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({context: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should return error after timeout when client is disconnected', async () => {
      const {client} = createMockClient({state: 'disconnected'})

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({context: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should return error after timeout when client is in reconnecting state', async () => {
      const {client} = createMockClient({state: 'reconnecting'})

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({context: 'test'})
      await clock.tickAsync(61_000)
      const result = await resultPromise

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Not connected')
      expect(result.content[0].text).to.include('timed out')
    })

    it('should resolve immediately when client becomes connected during wait', async () => {
      const {client} = createMockClient({state: 'reconnecting'})
      const currentClient = client

      const handler = setupCurateHandler({
        getClient: () => currentClient,
        getWorkingDirectory: () => '/project/root',
      })

      const resultPromise = handler({context: 'Auth uses JWT'})

      // After 2s, client reconnects (getState now returns 'connected')
      await clock.tickAsync(2000)
      ;(client.getState as SinonStub).returns('connected')
      await clock.tickAsync(1000)

      const result = await resultPromise

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('queued for curation')
    })
  })

  describe('handler — transport errors', () => {
    it('should return error when requestWithAck rejects', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.rejects(new Error('Connection refused'))

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'test'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Connection refused')
    })
  })

  describe('handler — fire-and-forget pattern', () => {
    it('should return immediately after queueing without waiting for task completion', async () => {
      const {client} = createMockClient()

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'Auth uses JWT'})

      // Returns success immediately — does NOT wait for task:completed
      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('queued for curation')
      expect(result.content[0].text).to.include('processed asynchronously')
    })

    it('should include taskId in the response message', async () => {
      const {client} = createMockClient()

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'test'})

      expect(result.content[0].text).to.include('taskId:')
    })
  })
})
