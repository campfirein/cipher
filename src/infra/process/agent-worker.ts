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

import type {AgentEventMap} from '../../core/domain/cipher/agent-events/types.js'
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
import {TaskQueueManager} from './task-queue-manager.js'

// IPC types imported from ./ipc-types.ts

function sendToParent(message: AgentIPCResponse): void {
  process.send?.(message)
}

/**
 * Log transport errors instead of silently swallowing them.
 * Used for fire-and-forget transport calls where we don't want to crash
 * but still want visibility into failures for debugging.
 */
function logTransportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  agentLog(`Transport error (non-fatal): ${message}`)
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

/** ChatSession ID - created once when agent starts, used for all tasks */
let chatSessionId: string | undefined
/** Whether the agent is fully initialized (has auth + config) */
let isAgentInitialized = false
/** Initialization error if agent couldn't be initialized */
let initializationError: Error | undefined
/** Guard: prevent concurrent initialization attempts */
let isInitializing = false
/** Guard: prevent double cleanup */
let isCleaningUp = false

/**
 * Stored event forwarder references for cleanup on reinit.
 * Prevents memory leaks from accumulating listeners.
 */
type EventForwarder = {
  event: string
  handler: (payload: unknown) => void
}
let eventForwarders: EventForwarder[] = []

// ============================================================================
// Task Queue Manager (replaces inline queue logic)
// ============================================================================

/**
 * Task queue manager handles:
 * - Separate queues for curate and query tasks
 * - Concurrency limits (max 2 concurrent per type)
 * - Task deduplication (same taskId can't be queued twice)
 * - Cancel tasks from queue before processing
 * - FIFO processing order
 */
const taskQueueManager = new TaskQueueManager({
  curate: {maxConcurrent: 2},
  query: {maxConcurrent: 2},
})

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
 * Cleanup event forwarders from previous agent instance.
 * Prevents memory leaks when agent is reinitialized.
 */
function cleanupAgentEventForwarding(): void {
  if (eventForwarders.length === 0) {
    return
  }

  // Get the old agent's event bus (if still available)
  // Cast to CipherAgent to access agentEventBus property
  const eventBus = (cipherAgent as CipherAgent | undefined)?.agentEventBus
  if (eventBus) {
    for (const {event, handler} of eventForwarders) {
      eventBus.off(event as 'llmservice:thinking', handler as () => void)
    }
  }

  // Clear the stored references
  eventForwarders = []
  agentLog('Event forwarders cleaned up')
}

/**
 * Setup event forwarding from CipherAgent to Transport.
 * agent-worker subscribes directly to agentEventBus (owns the agent).
 * Events are forwarded with currentTaskId.
 *
 * IMPORTANT: This function now stores handler references and cleans up
 * old handlers on reinit to prevent memory leaks.
 */
function setupAgentEventForwarding(agent: CipherAgent): void {
  // Clean up old forwarders first (prevents accumulation on reinit)
  cleanupAgentEventForwarding()

  const eventBus = agent.agentEventBus
  if (!eventBus) {
    agentLog('No agentEventBus available for event forwarding')
    return
  }

  // Helper to register and track event forwarder
  const registerForwarder = <T>(event: string, handler: (payload: T) => void): void => {
    eventBus.on(event as 'llmservice:thinking', handler as () => void)
    eventForwarders.push({event, handler: handler as (payload: unknown) => void})
  }

  // Forward llmservice:thinking
  registerForwarder('llmservice:thinking', (payload: AgentEventMap['llmservice:thinking']) => {
    if (payload.taskId) {
      transportClient
        ?.request('llmservice:thinking', {sessionId: payload.sessionId, taskId: payload.taskId})
        .catch(logTransportError)
    }
  })

  // Forward llmservice:chunk
  registerForwarder('llmservice:chunk', (payload: AgentEventMap['llmservice:chunk']) => {
    if (payload.taskId) {
      transportClient
        ?.request('llmservice:chunk', {
          content: payload.content,
          isComplete: payload.isComplete,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          type: payload.type,
        })
        .catch(logTransportError)
    }
  })

  // Forward llmservice:response
  registerForwarder('llmservice:response', (payload: AgentEventMap['llmservice:response']) => {
    if (payload.taskId && payload.content) {
      transportClient
        ?.request('llmservice:response', {
          content: payload.content,
          model: payload.model,
          partial: payload.partial,
          provider: payload.provider,
          reasoning: payload.reasoning,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          tokenUsage: payload.tokenUsage,
        })
        .catch(logTransportError)
    }
  })

  // Forward llmservice:toolCall
  registerForwarder('llmservice:toolCall', (payload: AgentEventMap['llmservice:toolCall']) => {
    if (payload.taskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolCall', {
          args: payload.args,
          callId: payload.callId,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          toolName: payload.toolName,
        })
        .catch(logTransportError)
    }
  })

  // Forward llmservice:toolResult
  registerForwarder('llmservice:toolResult', (payload: AgentEventMap['llmservice:toolResult']) => {
    if (payload.taskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolResult', {
          callId: payload.callId,
          error: payload.error,
          errorType: payload.errorType,
          metadata: payload.metadata,
          result: payload.result,
          sessionId: payload.sessionId,
          success: payload.success,
          taskId: payload.taskId,
          toolName: payload.toolName,
        })
        .catch(logTransportError)
    }
  })

  // Forward llmservice:error
  registerForwarder('llmservice:error', (payload: AgentEventMap['llmservice:error']) => {
    if (payload.taskId) {
      transportClient
        ?.request('llmservice:error', {
          code: payload.code,
          error: payload.error,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
        })
        .catch(logTransportError)
    }
  })

  // Forward llmservice:unsupportedInput
  registerForwarder('llmservice:unsupportedInput', (payload: AgentEventMap['llmservice:unsupportedInput']) => {
    if (payload.taskId) {
      transportClient
        ?.request('llmservice:unsupportedInput', {
          reason: payload.reason,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
        })
        .catch(logTransportError)
    }
  })

  agentLog(`Event forwarding setup complete (${eventForwarders.length} forwarders registered)`)
}

/**
 * Setup the task executor for TaskQueueManager.
 * Called after agent is initialized.
 */
function setupTaskExecutor(): void {
  taskQueueManager.setExecutor(async (task: TaskExecute) => {
    const {taskId, type} = task
    const stats = taskQueueManager.getStats(type)
    agentLog(`Processing task ${taskId} (${type}), ${stats.queued} queued, ${stats.active} active`)

    try {
      await handleTaskExecute(task)
    } catch (error) {
      agentLog(`Task execution failed: ${error}`)
      const errorData = serializeTaskError(error)
      transportClient?.request('task:error', {error: errorData, taskId}).catch(logTransportError)
    }
  })

  agentLog('Task executor setup complete')
}

/**
 * Try to initialize/reinitialize the CipherAgent.
 * Called on startup and lazily when tasks arrive but agent is not initialized.
 * This handles the case where user completes onboarding after agent starts.
 *
 * @param forceReinit - Force reinitialization even if already initialized (for config reload)
 */
async function tryInitializeAgent(forceReinit = false): Promise<boolean> {
  // Guard: prevent concurrent initialization
  if (isInitializing) {
    agentLog('Initialization already in progress, skipping')
    return false
  }

  // Already initialized and not forcing reinit
  if (!forceReinit && isAgentInitialized && cipherAgent && taskProcessor) {
    return true
  }

  isInitializing = true

  try {
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

    // Setup task executor for queue manager (enables processing)
    setupTaskExecutor()

    // Mark as initialized
    isAgentInitialized = true
    initializationError = undefined

    if (brvConfig) {
      agentLog(`Fully initialized with auth and config (team=${brvConfig.teamId}, space=${brvConfig.spaceId})`)
    } else {
      agentLog('Initialized with auth only (no project config yet - will reinit when config available)')
    }

    return true
  } finally {
    isInitializing = false
  }
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
      transportClient?.request('task:error', {error, taskId}).catch(logTransportError)
      return
    }

    agentLog('Lazy initialization successful!')
  }

  // NOTE: Config change detection removed - use explicit agent:restart event instead
  // (triggered by /init command via TransportHandlers)

  if (!taskProcessor) {
    agentLog('TaskProcessor not initialized')
    const error = serializeTaskError(new ProcessorNotInitError())
    transportClient?.request('task:error', {error, taskId}).catch(logTransportError)
    return
  }

  // Notify task started
  transportClient?.request('task:started', {taskId}).catch(logTransportError)

  try {
    // Process task - events stream via agentEventBus subscription
    // Response is forwarded via llmservice:response event (no manual send needed)
    // Agent uses its default session (Single-Session pattern)
    // File validation is handled by UseCase (business logic belongs there)
    // Note: taskId is passed to UseCase → CipherAgent → ChatSession, which adds it to all events
    const result = await taskProcessor!.process({
      content,
      files,
      taskId,
      type,
    })

    // Notify completion with result (required by TaskCompletedEventSchema)
    agentLog(`Task completed: ${taskId}`)
    transportClient?.request('task:completed', {result, taskId}).catch(logTransportError)
  } catch (error) {
    const errorData = serializeTaskError(error)
    agentLog(`Task error: ${taskId} - [${errorData.name}] ${errorData.message}`)
    transportClient?.request('task:error', {error: errorData, taskId}).catch(logTransportError)
  }
}

/**
 * Handle task:cancel from Transport.
 * Uses TaskQueueManager to remove from queue or signal cancellation.
 */
function handleTaskCancel(data: TaskCancel): void {
  const {taskId} = data
  agentLog(`Cancelling task: ${taskId}`)

  const result = taskQueueManager.cancel(taskId)

  if (result.success) {
    if (result.wasQueued) {
      // Task was in queue, not yet processing - removed by queue manager
      agentLog(`Task ${taskId} removed from ${result.taskType} queue (was waiting)`)
      // Notify transport that task was cancelled
      transportClient?.request('task:cancelled', {taskId}).catch(logTransportError)
    } else {
      // Task is currently processing - cancel via taskProcessor
      agentLog(`Task ${taskId} is processing, forwarding cancel to taskProcessor`)
      taskProcessor?.cancel(taskId)
    }
  } else {
    agentLog(`Task ${taskId} not found in queue or processing`)
  }
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

  // Setup event handlers - TaskQueueManager handles queueing and deduplication
  transportClient.on<TaskExecute>('task:execute', (data) => {
    const result = taskQueueManager.enqueue(data)

    if (result.success) {
      const stats = taskQueueManager.getStats(data.type)
      agentLog(`Task ${data.taskId} (${data.type}) queued at position ${result.position}, ${stats.queued} in queue`)
    } else if (result.reason === 'duplicate') {
      agentLog(`Task ${data.taskId} already known (duplicate), ignoring`)
    } else {
      agentLog(`Task ${data.taskId} rejected: ${result.reason}`)
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

  // Handle agent:restart from Transport (triggered by client, e.g., after /init)
  transportClient.on<{reason?: string}>('agent:restart', async (data) => {
    agentLog(`Agent restart requested: ${data.reason ?? 'no reason'}`)

    try {
      // Reinitialize agent with fresh config
      const success = await tryInitializeAgent(true) // forceReinit = true

      if (success) {
        agentLog('Agent reinitialized successfully')
        // Notify Transport that restart completed
        await transportClient?.request('agent:restarted', {success: true})
      } else {
        agentLog('Agent reinitialization failed - config incomplete')
        await transportClient?.request('agent:restarted', {
          error: 'Config incomplete (no auth token or config)',
          success: false,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      agentLog(`Agent reinitialization error: ${message}`)
      await transportClient?.request('agent:restarted', {error: message, success: false})
    }
  })

  agentLog('Ready to process tasks')
}

/**
 * Stop Agent Process.
 */
async function stopAgent(): Promise<void> {
  // Guard: prevent double cleanup
  if (isCleaningUp) {
    agentLog('Cleanup already in progress, skipping')
    return
  }

  isCleaningUp = true

  try {
    // Clear task queue
    taskQueueManager.clear()

    // Cleanup event forwarders before stopping agent
    cleanupAgentEventForwarding()

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
    isAgentInitialized = false
    agentLog('Stopped')
  } finally {
    isCleaningUp = false
  }
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
