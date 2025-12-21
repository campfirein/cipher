/**
 * Agent Worker - Entry point for Agent Process.
 *
 * Architecture v0.5.0:
 * - Connects to Transport as Socket.IO CLIENT
 * - Contains TaskProcessor + UseCases + CipherAgent
 * - Receives tasks via Socket.IO (task:execute)
 * - Sends results back via Socket.IO (task:chunk, task:completed, etc.)
 * - NO Socket.IO server (Transport is the only server)
 *
 * IPC messages:
 * - Receives: 'ping', 'shutdown'
 * - Sends: 'ready', 'pong', 'stopped', 'error'
 *
 * Socket.IO events (as client):
 * - Sends: 'agent:register' (identify as Agent)
 * - Receives: 'task:execute', 'task:cancel', 'shutdown'
 * - Sends: 'task:started', 'task:chunk', 'task:completed', 'task:error', 'task:toolCall', 'task:toolResult'
 */

import {randomUUID} from 'node:crypto'

import type {TaskCancel, TaskExecute} from '../../core/domain/transport/schemas.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'
import type {AgentIPCResponse, IPCCommand} from './ipc-types.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {NotAuthenticatedError, ProcessorNotInitError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {agentLog} from '../../utils/process-logger.js'
import {CipherAgent} from '../cipher/agent/index.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {createTaskProcessor, TaskProcessor} from '../core/task-processor.js'
import {KeychainTokenStore} from '../storage/keychain-token-store.js'
import {createTransportClient} from '../transport/transport-factory.js'
import {CurateUseCaseV2} from '../usecase/curate-use-case-v2.js'
import {QueryUseCaseV2} from '../usecase/query-use-case-v2.js'

// IPC types imported from ./ipc-types.ts

function sendToParent(message: AgentIPCResponse): void {
  process.send?.(message)
}

// Task types imported from core/domain/transport/schemas.ts:
// - TaskExecute: Transport → Agent (task:execute event)
// - TaskCancel: Transport → Agent (task:cancel event)

// ============================================================================
// Agent Process
// ============================================================================

let transportClient: ITransportClient | undefined
let taskProcessor: TaskProcessor | undefined
let cipherAgent: ICipherAgent | undefined
/** Current task being processed (for event routing) */
let currentTaskId: string | undefined
/** ChatSession ID - created once when agent starts, used for all tasks */
let chatSessionId: string | undefined
/** Whether the agent is fully initialized (has auth + config) */
let isAgentInitialized = false
/** Initialization error if agent couldn't be initialized */
let initializationError: Error | undefined
/** Config identity from last initialization (teamId:spaceId) - for change detection */
let lastConfigIdentity: string | undefined

// ============================================================================
// Curate Task Queue (In-Memory, FIFO, Max 2 Concurrent)
// ============================================================================

/** Queue of pending curate tasks (FIFO) */
const curateQueue: TaskExecute[] = []
/** Number of curate tasks currently being processed */
let activeCurateTasks = 0
/** Maximum concurrent curate tasks */
const MAX_CONCURRENT_CURATE = 2

/**
 * Try to process next curate task from queue.
 * Only processes if under concurrency limit.
 */
function tryProcessNextCurate(): void {
  if (activeCurateTasks >= MAX_CONCURRENT_CURATE) {
    agentLog(`Curate queue: ${curateQueue.length} waiting, ${activeCurateTasks} active (at limit)`)
    return
  }

  if (curateQueue.length === 0) {
    return
  }

  const data = curateQueue.shift()! // FIFO
  activeCurateTasks++
  agentLog(`Curate queue: picked task ${data.taskId}, ${curateQueue.length} remaining, ${activeCurateTasks} active`)

  handleTaskExecute(data)
    .catch((error) => {
      agentLog(`Task execution failed: ${error}`)
      const errorData = serializeTaskError(error)
      transportClient?.request('task:error', {error: errorData, taskId: data.taskId}).catch(() => {})
    })
    .finally(() => {
      activeCurateTasks--
      agentLog(`Curate task ${data.taskId} done, ${activeCurateTasks} active`)
      // Try to process next from queue
      tryProcessNextCurate()
    })
}

/**
 * Get Transport port from environment.
 */
function getTransportPort(): number {
  const portStr = process.env.TRANSPORT_PORT
  if (!portStr) {
    throw new Error('TRANSPORT_PORT environment variable not set')
  }

  const port = Number.parseInt(portStr, 10)
  if (Number.isNaN(port)) {
    throw new TypeError(`Invalid TRANSPORT_PORT: ${portStr}`)
  }

  return port
}

/**
 * Setup event forwarding from CipherAgent to Transport.
 * agent-worker subscribes directly to agentEventBus (owns the agent).
 * Events are forwarded with currentTaskId.
 */
function setupAgentEventForwarding(agent: CipherAgent): void {
  const eventBus = agent.agentEventBus
  if (!eventBus) {
    agentLog('No agentEventBus available for event forwarding')
    return
  }

  // Forward llmservice:thinking
  // Transport type: AgentEventMap['llmservice:thinking'] & { taskId: string }
  eventBus.on('llmservice:thinking', (payload) => {
    if (currentTaskId) {
      transportClient?.request('llmservice:thinking', {sessionId: payload.sessionId, taskId: currentTaskId}).catch(() => {})
    }
  })

  // Forward llmservice:chunk
  // Transport type: AgentEventMap['llmservice:chunk'] & { taskId: string }
  eventBus.on('llmservice:chunk', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:chunk', {
          content: payload.content,
          isComplete: payload.isComplete,
          sessionId: payload.sessionId,
          taskId: currentTaskId,
          type: payload.type,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:response
  // Transport type: AgentEventMap['llmservice:response'] & { taskId: string }
  eventBus.on('llmservice:response', (payload) => {
    if (currentTaskId && payload.content) {
      transportClient
        ?.request('llmservice:response', {
          content: payload.content,
          model: payload.model,
          partial: payload.partial,
          provider: payload.provider,
          reasoning: payload.reasoning,
          sessionId: payload.sessionId,
          taskId: currentTaskId,
          tokenUsage: payload.tokenUsage,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:toolCall
  // Transport type: AgentEventMap['llmservice:toolCall'] & { taskId: string }
  eventBus.on('llmservice:toolCall', (payload) => {
    if (currentTaskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolCall', {
          args: payload.args,
          callId: payload.callId,
          sessionId: payload.sessionId,
          taskId: currentTaskId,
          toolName: payload.toolName,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:toolResult
  // Transport type: AgentEventMap['llmservice:toolResult'] & { taskId: string }
  eventBus.on('llmservice:toolResult', (payload) => {
    if (currentTaskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolResult', {
          callId: payload.callId,
          error: payload.error,
          errorType: payload.errorType,
          metadata: payload.metadata,
          result: payload.result,
          sessionId: payload.sessionId,
          success: payload.success,
          taskId: currentTaskId,
          toolName: payload.toolName,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:error
  // Transport type: AgentEventMap['llmservice:error'] & { taskId: string }
  eventBus.on('llmservice:error', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:error', {
          code: payload.code,
          error: payload.error,
          sessionId: payload.sessionId,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:unsupportedInput
  // Transport type: AgentEventMap['llmservice:unsupportedInput'] & { taskId: string }
  eventBus.on('llmservice:unsupportedInput', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:unsupportedInput', {
          reason: payload.reason,
          sessionId: payload.sessionId,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  agentLog('Event forwarding setup complete')
}

/**
 * Try to initialize/reinitialize the CipherAgent.
 * Called on startup and lazily when tasks arrive but agent is not initialized.
 * This handles the case where user completes onboarding after agent starts.
 *
 * @param forceReinit - Force reinitialization even if already initialized (for config reload)
 */
async function tryInitializeAgent(forceReinit = false): Promise<boolean> {
  // Already initialized and not forcing reinit
  if (!forceReinit && isAgentInitialized && cipherAgent && taskProcessor) {
    return true
  }

  // If forcing reinit, stop existing agent first
  if (forceReinit && cipherAgent) {
    agentLog('Reinitializing with new config...')
    try {
      await (cipherAgent as CipherAgent).stop()
    } catch (error) {
      agentLog(`Error stopping previous agent: ${error}`)
    }

    cipherAgent = undefined
    taskProcessor = undefined
    isAgentInitialized = false
  }

  const tokenStore = new KeychainTokenStore()
  const configStore = new ProjectConfigStore()

  const authToken = await tokenStore.load()
  const brvConfig = await configStore.read()

  // Need at least authToken to initialize
  if (!authToken) {
    initializationError = new NotAuthenticatedError()
    agentLog('Cannot initialize - no auth token')
    return false
  }

  // Create V2 UseCases
  const curateUseCase = new CurateUseCaseV2()
  const queryUseCase = new QueryUseCaseV2()

  // Initialize CipherAgent
  const envConfig = getCurrentConfig()
  const agentConfig = {
    accessToken: authToken.accessToken,
    apiBaseUrl: envConfig.llmApiBaseUrl,
    fileSystem: {workingDirectory: process.cwd()},
    llm: {
      maxIterations: 10,
      maxTokens: 4096,
      temperature: 0.7,
      topK: 10,
      topP: 0.95,
      verbose: false,
    },
    model: 'gemini-2.5-pro',
    projectId: PROJECT,
    sessionKey: authToken.sessionKey,
  }

  const agent = new CipherAgent(agentConfig, brvConfig ?? undefined)
  await agent.start()
  agentLog('CipherAgent started')

  // Create ChatSession
  chatSessionId = `agent-session-${randomUUID()}`
  await agent.createSession(chatSessionId)
  agentLog(`ChatSession created: ${chatSessionId}`)

  // Setup event forwarding
  setupAgentEventForwarding(agent)
  cipherAgent = agent

  // Create TaskProcessor
  taskProcessor = createTaskProcessor({
    curateUseCase,
    queryUseCase,
  })
  taskProcessor.setAgent(cipherAgent)

  // Mark as initialized and track config identity for change detection
  isAgentInitialized = true
  initializationError = undefined
  lastConfigIdentity = brvConfig ? `${brvConfig.teamId}:${brvConfig.spaceId}` : undefined

  if (brvConfig) {
    agentLog(`Fully initialized with auth and config (team=${brvConfig.teamId}, space=${brvConfig.spaceId})`)
  } else {
    agentLog('Initialized with auth only (no project config yet - will reinit when config available)')
  }

  return true
}

/**
 * Handle task:execute from Transport.
 */
async function handleTaskExecute(data: TaskExecute): Promise<void> {
  const {content, files, taskId, type} = data

  agentLog(`Processing task: ${taskId} (type=${type})`)

  // If not initialized, try to initialize now (lazy init for post-onboarding)
  if (!isAgentInitialized) {
    agentLog('Not initialized, attempting lazy initialization...')
    const initialized = await tryInitializeAgent()
    if (!initialized) {
      agentLog('Lazy initialization failed')
      const error = serializeTaskError(initializationError ?? new ProcessorNotInitError())
      transportClient?.request('task:error', {error, taskId})
      return
    }

    agentLog('Lazy initialization successful!')
  }

  // Check if config has changed (new config or updated team/space)
  // This handles: user completes /init or re-inits with different team/space
  if (isAgentInitialized) {
    const configStore = new ProjectConfigStore()
    const brvConfig = await configStore.read()
    const currentConfigIdentity = brvConfig ? `${brvConfig.teamId}:${brvConfig.spaceId}` : undefined

    // Reinit if: config appeared (was undefined) OR config changed (different team/space)
    if (currentConfigIdentity !== lastConfigIdentity) {
      const reason =
        lastConfigIdentity === undefined
          ? 'config now available'
          : `config changed (${lastConfigIdentity} → ${currentConfigIdentity})`
      agentLog(`${reason}, reinitializing...`)

      const reinitialized = await tryInitializeAgent(true)
      if (!reinitialized) {
        agentLog('Reinitialization with new config failed')
        const error = serializeTaskError(initializationError ?? new ProcessorNotInitError())
        transportClient?.request('task:error', {error, taskId})
        return
      }

      agentLog('Reinitialization successful!')
    }
  }

  if (!taskProcessor) {
    agentLog('TaskProcessor not initialized')
    const error = serializeTaskError(new ProcessorNotInitError())
    transportClient?.request('task:error', {error, taskId})
    return
  }

  // Set current task for event routing
  currentTaskId = taskId

  try {
    // Notify task started
    transportClient?.request('task:started', {taskId}).catch(() => {})

    // Process task - events stream via agentEventBus subscription
    // Response is forwarded via llmservice:response event (no manual send needed)
    // Agent uses its default session (Single-Session pattern)
    // File validation is handled by UseCase (business logic belongs there)
    await taskProcessor.process({
      content,
      files,
      taskId,
      type,
    })

    // Notify completion
    agentLog(`Task completed: ${taskId}`)
    transportClient?.request('task:completed', {taskId}).catch(() => {})
  } catch (error) {
    const errorData = serializeTaskError(error)
    agentLog(`Task error: ${taskId} - [${errorData.name}] ${errorData.message}`)
    transportClient?.request('task:error', {error: errorData, taskId}).catch(() => {})
  } finally {
    currentTaskId = undefined
  }
}

/**
 * Handle task:cancel from Transport.
 */
function handleTaskCancel(data: TaskCancel): void {
  const {taskId} = data
  agentLog(`Cancelling task: ${taskId}`)
  taskProcessor?.cancel(taskId)
}

/**
 * Start Agent Process.
 */
async function startAgent(): Promise<void> {
  const port = getTransportPort()
  agentLog(`Connecting to Transport on port ${port}`)

  // Create Transport client
  transportClient = createTransportClient()

  // Connect to Transport
  await transportClient.connect(`http://localhost:${port}`)
  agentLog('Connected to Transport')

  // Register as Agent
  await transportClient.request('agent:register', {})
  agentLog('Registered with Transport')

  // Try to initialize agent (may fail if no auth yet - that's OK, will lazy init later)
  const initialized = await tryInitializeAgent()
  if (!initialized) {
    agentLog('Initial setup incomplete - will retry when tasks arrive (lazy init)')
  }

  // Setup event handlers
  transportClient.on<TaskExecute>('task:execute', (data) => {
    if (data.type === 'curate') {
      // Curate: add to queue (FIFO, max 2 concurrent)
      curateQueue.push(data)
      agentLog(`Curate task ${data.taskId} queued, ${curateQueue.length} in queue`)
      tryProcessNextCurate()
    } else {
      // Query: process immediately (no queue)
      handleTaskExecute(data).catch((error) => {
        agentLog(`Task execution failed: ${error}`)
        const errorData = serializeTaskError(error)
        transportClient?.request('task:error', {error: errorData, taskId: data.taskId}).catch(() => {})
      })
    }
  })

  transportClient.on<TaskCancel>('task:cancel', handleTaskCancel)

  // Handle shutdown from Transport
  transportClient.on('shutdown', () => {
    agentLog('Received shutdown from Transport')
    stopAgent().then(() => {
      sendToParent({type: 'stopped'})
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(0)
    })
  })

  agentLog('Ready to process tasks')
}

/**
 * Stop Agent Process.
 */
async function stopAgent(): Promise<void> {
  // Stop CipherAgent first
  if (cipherAgent) {
    await (cipherAgent as CipherAgent).stop()
    cipherAgent = undefined
    agentLog('CipherAgent stopped')
  }

  if (transportClient) {
    await transportClient.disconnect()
    transportClient = undefined
  }

  taskProcessor = undefined
  agentLog('Stopped')
}

// ============================================================================
// Worker Entry Point
// ============================================================================

async function runWorker(): Promise<void> {
  try {
    await startAgent()
    sendToParent({type: 'ready'})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    agentLog(`Failed to start: ${message}`)
    sendToParent({error: message, type: 'error'})
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  // IPC message handler
  process.on('message', async (msg: IPCCommand) => {
    if (msg.type === 'ping') {
      sendToParent({type: 'pong'})
    } else if (msg.type === 'shutdown') {
      await stopAgent()
      sendToParent({type: 'stopped'})
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    }
  })

  // Signal handlers
  const cleanup = async (): Promise<void> => {
    await stopAgent()
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }

  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
  process.on('disconnect', cleanup)
}

// ============================================================================
// Run
// ============================================================================

try {
  await runWorker()
} catch (error) {
  agentLog(`Fatal error: ${error}`)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
