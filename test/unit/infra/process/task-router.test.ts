/**
 * TaskRouter Unit Tests
 *
 * Tests task lifecycle and LLM event routing.
 *
 * Key scenarios:
 * - Task create → store + ACK + broadcast + submit pool
 * - Duplicate task create → idempotent
 * - Task without agentPool → error
 * - Invalid task type → error
 * - Task lifecycle (started, completed, error, cancelled)
 * - Task cancellation (with/without agent)
 * - LLM event routing (active, grace period, expired, unknown taskId)
 * - failTask → error to client + remove
 * - Pool rejection → error sent to client
 * - getTasksForProject lookup
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IAgentPool, SubmitTaskResult} from '../../../../src/server/core/interfaces/agent/i-agent-pool.js'
import type {IProjectRegistry} from '../../../../src/server/core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../../../src/server/core/interfaces/routing/i-project-router.js'
import type {
  ITransportServer,
  RequestHandler,
} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {
  LlmEventNames,
  TransportTaskEventNames,
} from '../../../../src/server/core/domain/transport/schemas.js'
import {TaskRouter} from '../../../../src/server/infra/process/task-router.js'

// ============================================================================
// Helpers
// ============================================================================

function makeProjectInfo(projectPath: string) {
  return {
    projectPath,
    registeredAt: Date.now(),
    sanitizedPath: projectPath.replaceAll('/', '_'),
    storagePath: `/data${projectPath}`,
  }
}

function makeStubTransportServer(sandbox: SinonSandbox) {
  const requestHandlers = new Map<string, RequestHandler>()

  const transport: ITransportServer = {
    addToRoom: sandbox.stub(),
    broadcast: sandbox.stub(),
    broadcastTo: sandbox.stub(),
    getPort: sandbox.stub().returns(3000),
    isRunning: sandbox.stub().returns(true),
    onConnection: sandbox.stub(),
    onDisconnection: sandbox.stub(),
    onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
      requestHandlers.set(event, handler)
    }),
    removeFromRoom: sandbox.stub(),
    sendTo: sandbox.stub(),
    start: sandbox.stub().resolves(),
    stop: sandbox.stub().resolves(),
  }

  return {requestHandlers, transport}
}

function makeStubAgentPool(sandbox: SinonSandbox): IAgentPool & {
  notifyTaskCompleted: SinonStub
  submitTask: SinonStub
} {
  return {
    getEntries: sandbox.stub().returns([]),
    getSize: sandbox.stub().returns(0),
    handleAgentDisconnected: sandbox.stub(),
    hasAgent: sandbox.stub().returns(false),
    markIdle: sandbox.stub(),
    notifyTaskCompleted: sandbox.stub(),
    shutdown: sandbox.stub().resolves(),
    submitTask: sandbox.stub().resolves({success: true} as SubmitTaskResult),
  }
}

function makeStubProjectRegistry(sandbox: SinonSandbox): IProjectRegistry & {get: SinonStub} {
  return {
    get: sandbox.stub().callsFake((path: string) => makeProjectInfo(path)),
    getAll: sandbox.stub().returns(new Map()),
    register: sandbox.stub().callsFake((path: string) => makeProjectInfo(path)),
    unregister: sandbox.stub().returns(true),
  }
}

function makeStubProjectRouter(sandbox: SinonSandbox): IProjectRouter & {broadcastToProject: SinonStub} {
  return {
    addToProjectRoom: sandbox.stub(),
    broadcastToProject: sandbox.stub(),
    getProjectMembers: sandbox.stub().returns([]),
    removeFromProjectRoom: sandbox.stub(),
  }
}

function makeTaskCreateRequest(overrides: Record<string, unknown> = {}) {
  return {
    content: 'test content',
    projectPath: '/app',
    taskId: randomUUID(),
    type: 'curate' as const,
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('TaskRouter', () => {
  let sandbox: SinonSandbox
  let transportHelper: ReturnType<typeof makeStubTransportServer>
  let agentPool: ReturnType<typeof makeStubAgentPool>
  let projectRegistry: ReturnType<typeof makeStubProjectRegistry>
  let projectRouter: ReturnType<typeof makeStubProjectRouter>
  let getAgentForProject: SinonStub
  let router: TaskRouter

  beforeEach(() => {
    sandbox = createSandbox()

    transportHelper = makeStubTransportServer(sandbox)
    agentPool = makeStubAgentPool(sandbox)
    projectRegistry = makeStubProjectRegistry(sandbox)
    projectRouter = makeStubProjectRouter(sandbox)
    getAgentForProject = sandbox.stub().returns('agent-1')

    router = new TaskRouter({
      agentPool,
      getAgentForProject,
      projectRegistry,
      projectRouter,
      transport: transportHelper.transport,
    })

    router.setup()
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ==========================================================================
  // Task Create
  // ==========================================================================

  describe('task:create', () => {
    it('should accept task and return taskId', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      expect(handler).to.exist

      const request = makeTaskCreateRequest()
      const result = await handler!(request, 'client-1')

      expect(result).to.deep.equal({taskId: request.taskId})
    })

    it('should send ACK to client after hooks resolve', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      await handler!(request, 'client-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.ACK,
        {taskId: request.taskId},
      )).to.be.true
    })

    it('should broadcast task:created to project room', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      handler!(request, 'client-1')

      const broadcastCall = projectRouter.broadcastToProject.getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.CREATED,
      )
      expect(broadcastCall).to.exist
      expect(broadcastCall!.args[0]).to.equal(makeProjectInfo('/app').sanitizedPath)
      expect(broadcastCall!.args[2]).to.have.property('taskId', request.taskId)
      expect(broadcastCall!.args[2]).to.have.property('content', 'test content')
    })

    it('should submit task to agent pool', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      handler!(request, 'client-1')

      // Wait for async pool submission
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(agentPool.submitTask.calledOnce).to.be.true
      const submittedTask = agentPool.submitTask.firstCall.args[0]
      expect(submittedTask).to.have.property('taskId', request.taskId)
      expect(submittedTask).to.have.property('clientId', 'client-1')
      expect(submittedTask).to.have.property('content', 'test content')
      expect(submittedTask).to.have.property('type', 'curate')
    })

    it('should return same taskId for duplicate create (idempotent)', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      const result1 = await handler!(request, 'client-1')
      const result2 = await handler!(request, 'client-1')

      expect(result1).to.deep.equal(result2)
      // Only submitted once
      expect(agentPool.submitTask.calledOnce).to.be.true
    })

    it('should send error when no agentPool available', () => {
      // Create router without agentPool
      const helper = makeStubTransportServer(sandbox)
      const routerNoPool = new TaskRouter({
        getAgentForProject: sandbox.stub(),
        projectRegistry,
        projectRouter,
        transport: helper.transport,
      })
      routerNoPool.setup()

      const handler = helper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      handler!(request, 'client-1')

      // Should send error to client
      const errorCall = (helper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.ERROR,
      )
      expect(errorCall).to.exist
      expect(errorCall!.args[2]).to.have.property('taskId', request.taskId)
      expect(errorCall!.args[2].error).to.have.property('name', 'AgentNotAvailableError')
    })

    it('should send error for invalid task type', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest({type: 'invalid_type'})

      handler!(request, 'client-1')

      // Should send error to client
      const errorCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.ERROR,
      )
      expect(errorCall).to.exist
      expect(errorCall!.args[2]).to.have.property('taskId', request.taskId)
    })

    it('should handle pool rejection by sending error to client', async () => {
      agentPool.submitTask.resolves({
        message: 'Pool is full',
        reason: 'pool_full',
        success: false,
      } as SubmitTaskResult)

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()

      handler!(request, 'client-1')

      // Wait for async pool submission
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // Should send error to client after pool rejection
      const errorCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.ERROR,
      )
      expect(errorCall).to.exist
      expect(errorCall!.args[2]).to.have.property('taskId', request.taskId)
    })

    it('should include files and clientCwd in submitted task', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest({
        clientCwd: '/home/user/project',
        files: ['src/auth.ts', 'src/middleware.ts'],
      })

      handler!(request, 'client-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const submittedTask = agentPool.submitTask.firstCall.args[0]
      expect(submittedTask).to.have.property('clientCwd', '/home/user/project')
      expect(submittedTask.files).to.deep.equal(['src/auth.ts', 'src/middleware.ts'])
    })

    it('should derive worktreeRoot from resolver when omitted', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-task-router-project-'))
      const worktreeRoot = join(projectRoot, 'packages', 'api')
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), '{}')
      mkdirSync(worktreeRoot, {recursive: true})
      writeFileSync(join(worktreeRoot, '.brv-worktree.json'), JSON.stringify({projectRoot}))
      const canonicalProjectRoot = realpathSync(projectRoot)
      const canonicalWorkspaceRoot = realpathSync(worktreeRoot)

      try {
        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
        const request = makeTaskCreateRequest({
          clientCwd: worktreeRoot,
          projectPath: canonicalProjectRoot,
          worktreeRoot: undefined,
        })

        handler!(request, 'client-1')

        await new Promise((resolve) => {
          setTimeout(resolve, 10)
        })

        const submittedTask = agentPool.submitTask.firstCall.args[0]
        expect(submittedTask.worktreeRoot).to.equal(canonicalWorkspaceRoot)
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })

    it('should fall back worktreeRoot to projectPath when resolver returns null', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest({
        clientCwd: '/outside/project',
        projectPath: '/app',
        worktreeRoot: undefined,
      })

      handler!(request, 'client-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const submittedTask = agentPool.submitTask.firstCall.args[0]
      expect(submittedTask.worktreeRoot).to.equal('/app')
    })

    it('should reject worktreeRoot outside projectPath', async () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const taskId = randomUUID()

      const result = await handler!(
        {
          clientCwd: '/app/packages/api',
          content: 'invalid workspace',
          projectPath: '/app',
          taskId,
          type: 'query',
          worktreeRoot: '/other-project',
        },
        'client-1',
      )

      expect(result).to.deep.equal({taskId})
      expect(agentPool.submitTask.called).to.be.false
      const errorCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.ERROR,
      )
      expect(errorCall).to.exist
      expect(errorCall!.args[2].error.message).to.include('worktreeRoot')
    })

    it('should surface resolver errors instead of swallowing them', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'brv-task-router-broken-link-'))
      const worktreeRoot = join(projectRoot, 'packages', 'api')
      mkdirSync(worktreeRoot, {recursive: true})
      writeFileSync(join(worktreeRoot, '.brv-worktree.json'), JSON.stringify({projectRoot: '/missing/project'}))

      try {
        const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
        const taskId = randomUUID()

        const result = await handler!(
          {
            clientCwd: worktreeRoot,
            content: 'broken link',
            taskId,
            type: 'query',
          },
          'client-1',
        )

        expect(result).to.deep.equal({taskId})
        expect(agentPool.submitTask.called).to.be.false
        const errorCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
          (c) => c.args[1] === TransportTaskEventNames.ERROR,
        )
        expect(errorCall).to.exist
        expect(errorCall!.args[2].error.message).to.include('Worktree link broken')
      } finally {
        rmSync(projectRoot, {force: true, recursive: true})
      }
    })
  })

  // ==========================================================================
  // Task Lifecycle
  // ==========================================================================

  describe('task lifecycle', () => {
    let taskId: string

    beforeEach(async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      taskId = request.taskId
      await createHandler!(request, 'client-1')
      // Reset sendTo history to only track lifecycle events
      ;(transportHelper.transport.sendTo as SinonStub).resetHistory()
      projectRouter.broadcastToProject.resetHistory()
    })

    it('should route task:started to client and broadcast', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.STARTED)

      handler!({taskId}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.STARTED,
        {taskId},
      )).to.be.true

      // Should broadcast to project room with task metadata
      const broadcastCall = projectRouter.broadcastToProject.getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.STARTED,
      )
      expect(broadcastCall).to.exist
      expect(broadcastCall!.args[2]).to.have.property('taskId', taskId)
      expect(broadcastCall!.args[2]).to.have.property('content', 'test content')
    })

    it('should route task:completed to client and broadcast', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)

      handler!({result: 'done', taskId}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.COMPLETED,
        {result: 'done', taskId},
      )).to.be.true
    })

    it('should notify agentPool on task:completed', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)

      handler!({result: 'done', taskId}, 'agent-1')

      expect(agentPool.notifyTaskCompleted.calledWith('/app')).to.be.true
    })

    it('should route task:error to client and broadcast', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.ERROR)

      const error = {code: 'ERR_UNKNOWN', message: 'something broke', name: 'TaskError'}
      handler!({error, taskId}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.ERROR,
        {error, taskId},
      )).to.be.true
    })

    it('should notify agentPool on task:error', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.ERROR)

      handler!({error: {message: 'fail', name: 'Error'}, taskId}, 'agent-1')

      expect(agentPool.notifyTaskCompleted.calledWith('/app')).to.be.true
    })

    it('should route task:cancelled to client and broadcast', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CANCELLED)

      handler!({taskId}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.CANCELLED,
        {taskId},
      )).to.be.true
    })

    it('should remove task from active tasks after completion', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)

      handler!({result: 'done', taskId}, 'agent-1')

      expect(router.getTasksForProject('/app')).to.have.lengthOf(0)
    })

    it('should remove task from active tasks after error', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.ERROR)

      handler!({error: {message: 'fail', name: 'Error'}, taskId}, 'agent-1')

      expect(router.getTasksForProject('/app')).to.have.lengthOf(0)
    })
  })

  // ==========================================================================
  // Task Cancellation
  // ==========================================================================

  describe('task cancellation', () => {
    let taskId: string

    beforeEach(async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      taskId = request.taskId
      await createHandler!(request, 'client-1')
      ;(transportHelper.transport.sendTo as SinonStub).resetHistory()
    })

    it('should forward cancel to agent when agent connected', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CANCEL)

      const result = handler!({taskId}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'agent-1',
        TransportTaskEventNames.CANCEL,
        {taskId},
      )).to.be.true
    })

    it('should cancel task locally when no agent connected', () => {
      getAgentForProject.resetBehavior()

      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CANCEL)

      const result = handler!({taskId}, 'client-1')

      expect(result).to.deep.equal({success: true})

      // Should send cancelled to client directly
      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.CANCELLED,
        {taskId},
      )).to.be.true

      // Task should be removed
      expect(router.getTasksForProject('/app')).to.have.lengthOf(0)
    })

    it('should return error for unknown taskId', () => {
      const handler = transportHelper.requestHandlers.get(TransportTaskEventNames.CANCEL)

      const result = handler!({taskId: 'nonexistent'}, 'client-1')

      expect(result).to.deep.equal({error: 'Task not found', success: false})
    })
  })

  // ==========================================================================
  // LLM Event Routing
  // ==========================================================================

  describe('LLM event routing', () => {
    let taskId: string

    beforeEach(async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      taskId = request.taskId
      await createHandler!(request, 'client-1')
      ;(transportHelper.transport.sendTo as SinonStub).resetHistory()
      projectRouter.broadcastToProject.resetHistory()
    })

    it('should route llmservice:chunk to client and project room', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.CHUNK)
      expect(handler).to.exist

      handler!({content: 'hello', sessionId: 'sess-1', taskId, type: 'text'}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        LlmEventNames.CHUNK,
      )).to.be.true

      const broadcastCall = projectRouter.broadcastToProject.getCalls().find(
        (c) => c.args[1] === LlmEventNames.CHUNK,
      )
      expect(broadcastCall).to.exist
    })

    it('should route llmservice:response to client', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.RESPONSE)

      handler!({content: 'answer', sessionId: 'sess-1', taskId}, 'agent-1')

      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.RESPONSE,
      )
      expect(sendCall).to.exist
      expect(sendCall!.args[0]).to.equal('client-1')
    })

    it('should route llmservice:toolCall to client', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.TOOL_CALL)

      handler!({args: {path: '/file'}, sessionId: 'sess-1', taskId, toolName: 'read-file'}, 'agent-1')

      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.TOOL_CALL,
      )
      expect(sendCall).to.exist
    })

    it('should route llmservice:toolResult to client', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.TOOL_RESULT)

      handler!({result: 'file contents', sessionId: 'sess-1', success: true, taskId, toolName: 'read-file'}, 'agent-1')

      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.TOOL_RESULT,
      )
      expect(sendCall).to.exist
    })

    it('should route LLM events during grace period (after task completed)', () => {
      // Complete the task first
      const completedHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'done', taskId}, 'agent-1')

      ;(transportHelper.transport.sendTo as SinonStub).resetHistory()

      // LLM event arrives late — should still route via grace period
      const handler = transportHelper.requestHandlers.get(LlmEventNames.CHUNK)
      handler!({content: 'late chunk', sessionId: 'sess-1', taskId, type: 'text'}, 'agent-1')

      // Should still route to client (grace period active)
      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.CHUNK,
      )
      expect(sendCall).to.exist
      expect(sendCall!.args[0]).to.equal('client-1')
    })

    it('should silently drop LLM events for unknown taskId', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.CHUNK)

      handler!({content: 'orphan', sessionId: 'sess-1', taskId: 'unknown-task', type: 'text'}, 'agent-1')

      // Should NOT send to any client
      expect((transportHelper.transport.sendTo as SinonStub).called).to.be.false
    })

    it('should ignore LLM events without taskId', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.CHUNK)

      handler!({content: 'no task id', sessionId: 'sess-1', type: 'text'}, 'agent-1')

      expect((transportHelper.transport.sendTo as SinonStub).called).to.be.false
    })

    it('should route llmservice:thinking to client', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.THINKING)

      handler!({sessionId: 'sess-1', taskId}, 'agent-1')

      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.THINKING,
      )
      expect(sendCall).to.exist
    })

    it('should route llmservice:error to client', () => {
      const handler = transportHelper.requestHandlers.get(LlmEventNames.ERROR)

      handler!({error: 'model error', sessionId: 'sess-1', taskId}, 'agent-1')

      const sendCall = (transportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === LlmEventNames.ERROR,
      )
      expect(sendCall).to.exist
    })
  })

  // ==========================================================================
  // failTask
  // ==========================================================================

  describe('failTask', () => {
    let taskId: string

    beforeEach(async () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      taskId = request.taskId
      await createHandler!(request, 'client-1')
      ;(transportHelper.transport.sendTo as SinonStub).resetHistory()
      projectRouter.broadcastToProject.resetHistory()
    })

    it('should send error to client and remove task', () => {
      const error = {code: 'ERR_AGENT_DISCONNECTED', message: 'Agent disconnected', name: 'AgentDisconnectedError'}

      router.failTask(taskId, error)

      expect((transportHelper.transport.sendTo as SinonStub).calledWith(
        'client-1',
        TransportTaskEventNames.ERROR,
        {error, taskId},
      )).to.be.true

      expect(router.getTasksForProject('/app')).to.have.lengthOf(0)
    })

    it('should broadcast error to project room', () => {
      const error = {message: 'Agent disconnected', name: 'AgentDisconnectedError'}

      router.failTask(taskId, error)

      const broadcastCall = projectRouter.broadcastToProject.getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.ERROR,
      )
      expect(broadcastCall).to.exist
    })

    it('should be no-op for unknown taskId', () => {
      router.failTask('nonexistent', {message: 'test', name: 'Error'})

      expect((transportHelper.transport.sendTo as SinonStub).called).to.be.false
    })
  })

  // ==========================================================================
  // Lifecycle hooks
  // ==========================================================================

  describe('lifecycle hooks', () => {
    let hookOnCreate: SinonStub
    let hookOnCompleted: SinonStub
    let hookOnError: SinonStub
    let hookOnCancelled: SinonStub
    let hookOnToolResult: SinonStub
    let hookCleanup: SinonStub
    let routerWithHooks: TaskRouter
    let hookTransportHelper: ReturnType<typeof makeStubTransportServer>

    beforeEach(() => {
      hookOnCreate = sandbox.stub().resolves({logId: 'cur-123'})
      hookOnCompleted = sandbox.stub().resolves()
      hookOnError = sandbox.stub().resolves()
      hookOnCancelled = sandbox.stub().resolves()
      hookOnToolResult = sandbox.stub()
      hookCleanup = sandbox.stub()
      hookTransportHelper = makeStubTransportServer(sandbox)
      routerWithHooks = new TaskRouter({
        agentPool,
        getAgentForProject,
        lifecycleHooks: [
          {
            cleanup: hookCleanup,
            onTaskCancelled: hookOnCancelled,
            onTaskCompleted: hookOnCompleted,
            onTaskCreate: hookOnCreate,
            onTaskError: hookOnError,
            onToolResult: hookOnToolResult,
          },
        ],
        projectRegistry,
        projectRouter,
        transport: hookTransportHelper.transport,
      })
      routerWithHooks.setup()
    })

    it('should include logId in task:ack when hook returns one', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      expect(
        (hookTransportHelper.transport.sendTo as SinonStub).calledWith(
          'client-1',
          TransportTaskEventNames.ACK,
          {logId: 'cur-123', taskId: request.taskId},
        ),
      ).to.be.true
    })

    it('should include logId in task:completed when hook set it', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      const completedHandler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'done', taskId: request.taskId}, 'agent-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const completedCall = (hookTransportHelper.transport.sendTo as SinonStub).getCalls().find(
        (c) => c.args[1] === TransportTaskEventNames.COMPLETED,
      )
      expect(completedCall).to.exist
      expect(completedCall!.args[2]).to.have.property('logId', 'cur-123')
    })

    it('should call onTaskError and cleanup when failTask is called', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      routerWithHooks.failTask(request.taskId, {message: 'fail', name: 'Error'})

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(hookOnError.calledOnce).to.be.true
      expect(hookCleanup.calledWith(request.taskId)).to.be.true
    })

    it('should call onTaskCancelled and cleanup on task:cancelled from agent', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      const cancelledHandler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CANCELLED)
      cancelledHandler!({taskId: request.taskId}, 'agent-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(hookOnCancelled.calledOnce).to.be.true
      expect(hookOnError.called).to.be.false
      expect(hookCleanup.calledWith(request.taskId)).to.be.true
    })

    it('should call onTaskError and cleanup on task:error from agent', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      const errorHandler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.ERROR)
      errorHandler!({error: {message: 'fail', name: 'Error'}, taskId: request.taskId}, 'agent-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(hookOnError.calledOnce).to.be.true
      expect(hookCleanup.calledWith(request.taskId)).to.be.true
    })

    it('should NOT call onTaskCreate when no agentPool available', async () => {
      const helper = makeStubTransportServer(sandbox)
      const routerNoPool = new TaskRouter({
        getAgentForProject: sandbox.stub(),
        lifecycleHooks: [{cleanup: hookCleanup, onTaskCreate: hookOnCreate}],
        projectRegistry,
        projectRouter,
        transport: helper.transport,
      })
      routerNoPool.setup()

      const handler = helper.requestHandlers.get(TransportTaskEventNames.CREATE)
      await handler!(makeTaskCreateRequest(), 'client-1')

      expect(hookOnCreate.called).to.be.false
    })

    it('should NOT call onTaskCreate when invalid task type', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      await handler!(makeTaskCreateRequest({type: 'invalid_type'}), 'client-1')

      expect(hookOnCreate.called).to.be.false
    })

    it('should call onTaskError when pool rejects task', async () => {
      agentPool.submitTask.resolves({
        message: 'Pool is full',
        reason: 'pool_full',
        success: false,
      } as SubmitTaskResult)

      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(hookOnError.calledOnce).to.be.true
      expect(hookCleanup.calledWith(request.taskId)).to.be.true
    })

    it('should NOT call onToolResult for grace-period completed tasks', async () => {
      const handler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      await handler!(request, 'client-1')

      // Complete the task (moves to grace period)
      const completedHandler = hookTransportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'done', taskId: request.taskId}, 'agent-1')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      hookOnToolResult.resetHistory()

      // Tool result arrives during grace period (task is in completedTasks, NOT tasks)
      const toolResultHandler = hookTransportHelper.requestHandlers.get(LlmEventNames.TOOL_RESULT)
      toolResultHandler!(
        {result: 'file', sessionId: 'sess-1', success: true, taskId: request.taskId, toolName: 'curate'},
        'agent-1',
      )

      expect(hookOnToolResult.called).to.be.false
    })
  })

  // ==========================================================================
  // getTasksForProject
  // ==========================================================================

  describe('getTasksForProject', () => {
    beforeEach(() => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)

      // Task for /app
      createHandler!(makeTaskCreateRequest({projectPath: '/app', taskId: randomUUID()}), 'client-1')
      // Task for /other
      createHandler!(makeTaskCreateRequest({projectPath: '/other', taskId: randomUUID()}), 'client-2')
      // Task without projectPath
      createHandler!(makeTaskCreateRequest({projectPath: undefined, taskId: randomUUID()}), 'client-3')
    })

    it('should return tasks for specific project (includes unassigned)', () => {
      const tasks = router.getTasksForProject('/app')
      // Should include /app task + unassigned task (projectPath === undefined)
      expect(tasks).to.have.lengthOf(2)
      const projectPaths = tasks.map((t) => t.projectPath)
      expect(projectPaths).to.include('/app')
      expect(projectPaths).to.include(undefined)
    })

    it('should NOT include tasks from other projects', () => {
      const tasks = router.getTasksForProject('/app')
      const otherProjectTasks = tasks.filter((t) => t.projectPath === '/other')
      expect(otherProjectTasks).to.have.lengthOf(0)
    })

    it('should return only unassigned tasks when no projectPath given', () => {
      const tasks = router.getTasksForProject()
      for (const task of tasks) {
        expect(task.projectPath).to.be.undefined
      }
    })
  })

  // ==========================================================================
  // clearTasks / getDebugState
  // ==========================================================================

  describe('utility methods', () => {
    it('should clear all tasks', () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      createHandler!(makeTaskCreateRequest(), 'client-1')

      router.clearTasks()

      expect(router.getTasksForProject('/app')).to.have.lengthOf(0)
    })

    it('should return debug state with active and completed tasks', () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      createHandler!(request, 'client-1')

      const state = router.getDebugState()
      expect(state.activeTasks).to.have.lengthOf(1)
      expect(state.activeTasks[0]).to.have.property('taskId', request.taskId)
      expect(state.completedTasks).to.have.lengthOf(0)
    })

    it('should move completed tasks to debug state', () => {
      const createHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.CREATE)
      const request = makeTaskCreateRequest()
      createHandler!(request, 'client-1')

      // Complete the task
      const completedHandler = transportHelper.requestHandlers.get(TransportTaskEventNames.COMPLETED)
      completedHandler!({result: 'done', taskId: request.taskId}, 'agent-1')

      const state = router.getDebugState()
      expect(state.activeTasks).to.have.lengthOf(0)
      expect(state.completedTasks).to.have.lengthOf(1)
      expect(state.completedTasks[0]).to.have.property('taskId', request.taskId)
    })
  })
})
