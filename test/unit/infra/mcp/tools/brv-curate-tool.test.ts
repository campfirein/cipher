import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonFakeTimers, type SinonStub, stub, useFakeTimers} from 'sinon'

import type {McpStartupProjectContext} from '../../../../../src/server/infra/mcp/tools/mcp-project-context.js'

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
 * Registers the brv-curate tool on a mock McpServer and returns the captured handler.
 */
function setupCurateHandler(options: {
  getClient: () => ITransportClient | undefined
  getStartupProjectContext?: () => McpStartupProjectContext | undefined
  getWorkingDirectory: () => string | undefined
}): CurateToolHandler {
  const {getHandler, server} = createMockMcpServer()
  registerBrvCurateTool(
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

  describe('handler — input validation', () => {
    it('should return error when neither context, files, nor folder provided', async () => {
      const {client} = createMockClient()
      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({cwd: '/some/path'})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Either context, files, folder')
    })

    it('should return error when context is whitespace-only with no files', async () => {
      const {client} = createMockClient()
      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: '   '})

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('Either context, files, folder')
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
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-curate-project-'))
      const otherProject = mkdtempSync(join(tmpdir(), 'brv-curate-other-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      mkdirSync(join(otherProject, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      writeFileSync(join(otherProject, '.brv', 'config.json'), '{}')
      const canonicalOtherProject = realpathSync(otherProject)

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub

        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: () => projectRoot,
        })

        await handler({context: 'test', cwd: otherProject})

        const payload = requestStub.firstCall.args[1]
        expect(payload.clientCwd).to.equal(otherProject)
        expect(payload.projectPath).to.equal(canonicalOtherProject)
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
        rmSync(otherProject, {force: true, recursive: true})
      }
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
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-curate-global-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      const canonicalProjectRoot = realpathSync(projectRoot)

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub

        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const result = await handler({context: 'Auth pattern', cwd: projectRoot})

        expect(result.isError).to.be.undefined
        expect(result.content[0].text).to.include('queued for curation')

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
    it('should retry project association once before queueing the task', async () => {
      const clock = useFakeTimers()
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-curate-retry-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        let associationAttempts = 0

        requestStub.callsFake((event: string) => {
          if (event === 'client:associateProject') {
            associationAttempts++
            if (associationAttempts === 1) {
              return new Promise(() => {})
            }

            return Promise.resolve({success: true})
          }

          return Promise.resolve({taskId: 'queued-task'})
        })

        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const resultPromise = handler({context: 'Auth pattern', cwd: projectRoot})
        await clock.tickAsync(3001)
        const result = await resultPromise

        expect(result.isError).to.be.undefined
        expect(result.content[0].text).to.include('queued for curation')
        expect(associationAttempts).to.equal(2)
      } finally {
        clock.restore()
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should return actionable error when project association fails twice', async () => {
      const clock = useFakeTimers()
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-curate-assoc-fail-'))
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')

      try {
        const {client} = createMockClient()
        const requestStub = client.requestWithAck as SinonStub
        requestStub.callsFake((event: string) => {
          if (event === 'client:associateProject') {
            return new Promise(() => {})
          }

          return Promise.resolve({taskId: 'queued-task'})
        })

        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const resultPromise = handler({context: 'Auth pattern', cwd: projectRoot})
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
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-curate-broken-link-'))
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      writeFileSync(join(workspace, '.brv'), JSON.stringify({projectRoot: '/missing/project'}))

      try {
        const {client} = createMockClient()
        const handler = setupCurateHandler({
          getClient: () => client,
          getWorkingDirectory: noWorkingDirectory,
        })

        const result = await handler({context: 'Auth pattern', cwd: workspace})

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

    it('should include logId in the response when ACK returns one', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.resolves({logId: 'cur-12345', taskId: 'some-uuid'})

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'test'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.include('logId: cur-12345')
    })

    it('should not include logId in the response when ACK returns none', async () => {
      const {client} = createMockClient()
      const requestStub = client.requestWithAck as SinonStub
      requestStub.resolves({taskId: 'some-uuid'})

      const handler = setupCurateHandler({
        getClient: () => client,
        getWorkingDirectory: () => '/project/root',
      })

      const result = await handler({context: 'test'})

      expect(result.isError).to.be.undefined
      expect(result.content[0].text).to.not.include('logId:')
    })
  })
})
