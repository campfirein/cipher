import {randomUUID} from 'node:crypto'

import type {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionInfoResponse,
  SessionListResponse,
  SessionSwitchRequest,
  SessionSwitchResponse,
  TaskCancelRequest,
  TaskCancelResponse,
  TaskCreateRequest,
  TaskCreateResponse,
} from '../../core/domain/transport/schemas.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {IInstanceManager} from '../../core/interfaces/instance/i-instance-manager.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {TaskProcessor} from './task-processor.js'

import {
  CoreProcessAlreadyRunningError,
  InstanceLockAcquisitionError,
  InstanceLockError,
} from '../../core/domain/errors/core-process-error.js'
import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'
import {FileInstanceManager} from '../instance/file-instance-manager.js'
import {findAvailablePort, isPortAvailable} from '../transport/port-utils.js'
import {createTransportServer} from '../transport/transport-factory.js'

/**
 * Core Process - Long-running server that handles Transport and CipherAgent.
 *
 * @deprecated Use ProcessManager + TransportHandlers + agent-worker from src/infra/process/ instead.
 * Architecture v0.5.0 uses 3-process model where Transport and Agent are separate processes.
 * This file is kept for backward compatibility with existing tests.
 *
 * Old architecture (deprecated):
 * - Single entry point for Core process
 * - OWNS single CipherAgent (1 per Core, long-lived)
 * - Uses Transport Factory (createTransportServer)
 * - Manages instance.json lifecycle (write on startup, cleanup on shutdown)
 * - Handles signal handlers for graceful shutdown
 */

/**
 * Core process configuration.
 */
export type CoreProcessConfig = {
  /** Instance manager for instance.json operations */
  instanceManager?: IInstanceManager
  /** Logger instance */
  logger?: ILogger
  /** Preferred port (will fallback to random if unavailable) */
  preferredPort?: number
  /** Project root directory (default: cwd) */
  projectRoot?: string
  /** Task processor for handling tasks (injected with UseCases) */
  taskProcessor?: TaskProcessor
  /** Transport server instance */
  transportServer?: ITransportServer
}

/**
 * Core process state.
 */
export type CoreProcessState = {
  /** Current active session ID */
  currentSessionId: string | undefined
  /** Port the server is running on */
  port: number | undefined
  /** Whether the process is running */
  running: boolean
}

/**
 * Core Process - Orchestrates Transport, TaskProcessor, and CipherAgent.
 *
 * Architecture v0.5.0:
 * - CoreProcess OWNS single CipherAgent (1 per Core)
 * - Agent starts on start(), stops on stop()
 * - TaskProcessor receives agent reference
 * - UseCases receive agent via executeWithAgent()
 *
 * Lifecycle:
 * 1. start() → start agent → find port → start transport → write instance.json → setup handlers
 * 2. Running: handle events from clients, agent processes tasks
 * 3. stop() → stop agent → stop transport → release instance.json
 */
export class CoreProcess {
  /**
   * Single CipherAgent owned by CoreProcess.
   * Architecture v0.5.0: 1 Agent per Core, starts on start(), stops on stop().
   * Agent manages its own session/memory internally.
   */
  private cipherAgent: ICipherAgent | undefined
  private readonly instanceManager: IInstanceManager
  private readonly logger: ILogger
  private readonly preferredPort: number | undefined
  private readonly projectRoot: string
  private signalHandlersSetup = false
  private state: CoreProcessState = {
    currentSessionId: undefined,
    port: undefined,
    running: false,
  }
  private readonly taskProcessor: TaskProcessor | undefined
  private readonly transportServer: ITransportServer

  constructor(config?: CoreProcessConfig) {
    this.projectRoot = config?.projectRoot ?? process.cwd()
    this.preferredPort = config?.preferredPort
    this.logger = config?.logger ?? new NoOpLogger()
    this.instanceManager = config?.instanceManager ?? new FileInstanceManager()
    this.taskProcessor = config?.taskProcessor
    // Use Factory pattern for Transport (v0.5.0 architecture)
    this.transportServer = config?.transportServer ?? createTransportServer()
  }

  /**
   * Get current state.
   */
  getState(): Readonly<CoreProcessState> {
    return {...this.state}
  }

  /**
   * Check if process is running.
   */
  isRunning(): boolean {
    return this.state.running
  }

  /**
   * Start the Core process.
   *
   * Architecture v0.5.0 Steps:
   * 1. Start CipherAgent (TODO: agent implementation handled separately)
   * 2. Find available port
   * 3. Start transport server
   * 4. Acquire instance lock (write instance.json)
   * 5. Setup event handlers
   * 6. Setup signal handlers
   *
   * @throws Error if already running or instance already exists
   */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new CoreProcessAlreadyRunningError()
    }

    // ==========================================================================
    // TODO: Start CipherAgent here (agent implementation handled separately)
    // ==========================================================================
    // When agent implementation is ready, uncomment and implement:
    //
    // this.cipherAgent = new CipherAgent(config)
    // await this.cipherAgent.start()
    // this.logger.info('CipherAgent started')
    //
    // Then pass agent to TaskProcessor:
    // this.taskProcessor?.setAgent(this.cipherAgent)
    // ==========================================================================
    this.logger.debug('TODO: CipherAgent start placeholder - agent handled separately')

    // Find available port
    const port = this.preferredPort ? await this.findPortWithPreference(this.preferredPort) : await findAvailablePort()
    this.logger.debug('Found available port', {port})

    // Start transport server
    await this.transportServer.start(port)
    this.state.port = port
    this.logger.info('Transport server started', {port})

    // Acquire instance lock
    const result = await this.instanceManager.acquire(this.projectRoot, port)
    if (!result.acquired) {
      // Rollback: stop transport
      await this.transportServer.stop()
      this.state.port = undefined

      if (result.reason === 'already_running') {
        throw new InstanceLockError(result.existingInstance?.pid, result.existingInstance?.port)
      }

      throw new InstanceLockAcquisitionError(result.reason)
    }

    this.logger.info('Instance lock acquired', {projectRoot: this.projectRoot})

    // Setup event handlers
    this.setupEventHandlers()

    // Setup signal handlers
    this.setupSignalHandlers()

    this.state.running = true
  }

  /**
   * Stop the Core process.
   *
   * Architecture v0.5.0 Steps:
   * 1. Stop CipherAgent (cleanup memory, close connections)
   * 2. Stop transport server
   * 3. Release instance lock (delete instance.json)
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      return
    }

    this.state.running = false

    // ==========================================================================
    // TODO: Stop CipherAgent here (agent implementation handled separately)
    // ==========================================================================
    // When agent implementation is ready, uncomment and implement:
    //
    // if (this.cipherAgent) {
    //   await this.cipherAgent.stop()  // or cleanup() method
    //   this.cipherAgent = undefined
    //   this.logger.info('CipherAgent stopped')
    // }
    // ==========================================================================
    if (this.cipherAgent) {
      // Agent cleanup placeholder - just clear reference for now
      this.cipherAgent = undefined
      this.logger.info('CipherAgent reference cleared')
    }

    // Stop transport
    await this.transportServer.stop()

    // Release instance lock
    await this.instanceManager.release(this.projectRoot)

    this.state.port = undefined
    this.state.currentSessionId = undefined
  }

  /**
   * Cleanup handler for graceful shutdown.
   */
  private async cleanup(): Promise<void> {
    this.logger.info('Shutting down...')
    await this.stop()
  }

  /**
   * Find available port with preference.
   */
  private async findPortWithPreference(preferred: number): Promise<number> {
    if (await isPortAvailable(preferred)) {
      return preferred
    }

    return findAvailablePort()
  }

  /**
   * Handle session:create request.
   */
  private handleSessionCreate(data: SessionCreateRequest, _clientId: string): SessionCreateResponse {
    const sessionId = randomUUID()
    this.state.currentSessionId = sessionId

    this.logger.info('Session created', {name: data.name, sessionId})

    // Broadcast session switch
    this.transportServer.broadcast('session:switched', {sessionId})

    return {sessionId}
  }

  /**
   * Handle session:info request.
   */
  private handleSessionInfo(_clientId: string): SessionInfoResponse {
    // Create default session if none exists
    if (!this.state.currentSessionId) {
      this.state.currentSessionId = randomUUID()
    }

    return {
      session: {
        createdAt: Date.now(),
        id: this.state.currentSessionId,
        lastActiveAt: Date.now(),
      },
      stats: {
        completedTasks: 0,
        failedTasks: 0,
        totalTasks: 0,
      },
    }
  }

  /**
   * Handle session:list request.
   */
  private handleSessionList(_clientId: string): SessionListResponse {
    // For now, return current session only
    const sessions = this.state.currentSessionId
      ? [
          {
            createdAt: Date.now(),
            id: this.state.currentSessionId,
            lastActiveAt: Date.now(),
          },
        ]
      : []

    return {sessions}
  }

  /**
   * Handle session:switch request.
   */
  private handleSessionSwitch(data: SessionSwitchRequest, _clientId: string): SessionSwitchResponse {
    this.state.currentSessionId = data.sessionId

    this.logger.info('Session switched', {sessionId: data.sessionId})

    // Broadcast session switch
    this.transportServer.broadcast('session:switched', {sessionId: data.sessionId})

    return {success: true}
  }

  /**
   * Handle task:cancel request.
   */
  private handleTaskCancel(data: TaskCancelRequest, _clientId: string): TaskCancelResponse {
    this.logger.info('Task cancel requested', {taskId: data.taskId})

    // TODO: Implement actual cancellation
    return {success: true}
  }

  /**
   * Handle task:create request.
   * Creates a new task and returns the task ID.
   * Routes to TaskProcessor for actual processing.
   */
  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const taskId = randomUUID()

    this.logger.info('Task created', {clientId, taskId, type: data.type})

    // Add client to task room for targeted broadcasts
    this.transportServer.addToRoom(clientId, `task:${taskId}`)

    // Send ack immediately (fast feedback)
    this.transportServer.broadcast('task:ack', {taskId})

    // Route to TaskProcessor if available
    if (this.taskProcessor) {
      // Process task asynchronously (don't await - return taskId immediately)
      // Note: Event streaming is handled by agent-worker in v0.5.0 architecture
      this.taskProcessor
        .process({
          content: data.input,
          taskId,
          type: data.type as 'curate' | 'query',
        })
        .then((result: string) => {
          this.transportServer.broadcastTo(`task:${taskId}`, 'task:completed', {result, taskId})
        })
        .catch((error: unknown) => {
          this.logger.error('Task processing failed', {error: String(error), taskId})
          this.transportServer.broadcastTo(`task:${taskId}`, 'task:error', {
            error: error instanceof Error ? error.message : String(error),
            taskId,
          })
        })
    } else {
      // No TaskProcessor - send error
      this.logger.warn('No TaskProcessor configured', {taskId})
      setTimeout(() => {
        this.transportServer.broadcastTo(`task:${taskId}`, 'task:error', {
          error: 'Task processing not available. Core not fully initialized.',
          taskId,
        })
      }, 100)
    }

    return {taskId}
  }

  /**
   * Setup transport event handlers.
   */
  private setupEventHandlers(): void {
    // Task handlers
    this.transportServer.onRequest<TaskCreateRequest, TaskCreateResponse>('task:create', (data, clientId) =>
      this.handleTaskCreate(data, clientId),
    )

    this.transportServer.onRequest<TaskCancelRequest, TaskCancelResponse>('task:cancel', (data, clientId) =>
      this.handleTaskCancel(data, clientId),
    )

    // Session handlers
    this.transportServer.onRequest<Record<string, never>, SessionInfoResponse>('session:info', (_data, clientId) =>
      this.handleSessionInfo(clientId),
    )

    this.transportServer.onRequest<Record<string, never>, SessionListResponse>('session:list', (_data, clientId) =>
      this.handleSessionList(clientId),
    )

    this.transportServer.onRequest<SessionCreateRequest, SessionCreateResponse>('session:create', (data, clientId) =>
      this.handleSessionCreate(data, clientId),
    )

    this.transportServer.onRequest<SessionSwitchRequest, SessionSwitchResponse>('session:switch', (data, clientId) =>
      this.handleSessionSwitch(data, clientId),
    )

    // Connection logging
    this.transportServer.onConnection((clientId) => {
      this.logger.debug('Client connected', {clientId})
    })

    this.transportServer.onDisconnection((clientId) => {
      this.logger.debug('Client disconnected', {clientId})
    })
  }

  /**
   * Setup signal handlers for graceful shutdown.
   */
  private setupSignalHandlers(): void {
    if (this.signalHandlersSetup) {
      return
    }

    process.once('SIGTERM', () => {
      this.cleanup().then(() => {
        // eslint-disable-next-line n/no-process-exit
        process.exit(0)
      })
    })

    process.once('SIGINT', () => {
      this.cleanup().then(() => {
        // eslint-disable-next-line n/no-process-exit
        process.exit(0)
      })
    })

    this.signalHandlersSetup = true
  }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let coreInstance: CoreProcess | undefined

/**
 * Create a new Core process instance.
 */
export function createCoreProcess(config?: CoreProcessConfig): CoreProcess {
  return new CoreProcess(config)
}

/**
 * Get or create singleton Core process.
 */
export function getCoreProcess(config?: CoreProcessConfig): CoreProcess {
  if (!coreInstance) {
    coreInstance = new CoreProcess(config)
  }

  return coreInstance
}

/**
 * Stop and dispose singleton Core process.
 */
export async function disposeCoreProcess(): Promise<void> {
  if (coreInstance) {
    await coreInstance.stop()
    coreInstance = undefined
  }
}
