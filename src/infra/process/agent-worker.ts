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

import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {NotAuthenticatedError, ProcessorNotInitError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {CipherAgent} from '../cipher/agent/index.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {createTaskProcessor, TaskProcessor} from '../core/task-processor.js'
import {KeychainTokenStore} from '../storage/keychain-token-store.js'
import {createTransportClient} from '../transport/transport-factory.js'
import {CurateUseCaseV2} from '../usecase/curate-use-case-v2.js'
import {QueryUseCaseV2} from '../usecase/query-use-case-v2.js'

// ============================================================================
// IPC Types
// ============================================================================

type IPCMessage = {type: 'ping'} | {type: 'shutdown'}
type IPCResponse = {error: string; type: 'error'} | {type: 'pong'} | {type: 'ready'} | {type: 'stopped'}

function sendToParent(message: IPCResponse): void {
  process.send?.(message)
}

// ============================================================================
// Task Types (from Transport)
// ============================================================================

type TaskExecuteMessage = {
  clientId: string
  files?: string[]
  input: string
  taskId: string
  type: 'curate' | 'query'
}

type TaskCancelMessage = {
  taskId: string
}

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
    console.warn('[Agent] No agentEventBus available for event forwarding')
    return
  }

  // Forward llmservice:thinking
  eventBus.on('llmservice:thinking', () => {
    if (currentTaskId) {
      transportClient?.request('llmservice:thinking', {taskId: currentTaskId}).catch(() => {})
    }
  })

  // Forward llmservice:chunk
  eventBus.on('llmservice:chunk', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:chunk', {
          content: payload.content,
          isComplete: payload.isComplete,
          taskId: currentTaskId,
          type: payload.type,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:response
  eventBus.on('llmservice:response', (payload) => {
    if (currentTaskId && payload.content) {
      transportClient?.request('llmservice:response', {content: payload.content, taskId: currentTaskId}).catch(() => {})
    }
  })

  // Forward llmservice:toolCall
  eventBus.on('llmservice:toolCall', (payload) => {
    if (currentTaskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolCall', {
          args: payload.args,
          callId: payload.callId,
          name: payload.toolName,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:toolResult
  eventBus.on('llmservice:toolResult', (payload) => {
    if (currentTaskId && payload.callId) {
      transportClient
        ?.request('llmservice:toolResult', {
          callId: payload.callId,
          error: payload.error,
          result: payload.result,
          success: payload.success,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:error
  eventBus.on('llmservice:error', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:error', {
          code: payload.code,
          error: payload.error,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  // Forward llmservice:unsupportedInput
  eventBus.on('llmservice:unsupportedInput', (payload) => {
    if (currentTaskId) {
      transportClient
        ?.request('llmservice:unsupportedInput', {
          reason: payload.reason,
          taskId: currentTaskId,
        })
        .catch(() => {})
    }
  })

  console.log('[Agent] Event forwarding setup complete')
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
    console.log('[Agent] Reinitializing with new config...')
    try {
      await (cipherAgent as CipherAgent).stop()
    } catch (error) {
      console.warn('[Agent] Error stopping previous agent:', error)
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
    console.warn('[Agent] Cannot initialize - no auth token')
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
  console.log('[Agent] CipherAgent started')

  // Create ChatSession
  chatSessionId = `agent-session-${randomUUID()}`
  await agent.createSession(chatSessionId)
  console.log(`[Agent] ChatSession created: ${chatSessionId}`)

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
    console.log(`[Agent] Fully initialized with auth and config (team=${brvConfig.teamId}, space=${brvConfig.spaceId})`)
  } else {
    console.log('[Agent] Initialized with auth only (no project config yet - will reinit when config available)')
  }

  return true
}

/**
 * Handle task:execute from Transport.
 */
async function handleTaskExecute(data: TaskExecuteMessage): Promise<void> {
  const {files, input, taskId, type} = data

  console.log(`[Agent] Processing task: ${taskId} (type=${type})`)

  // If not initialized, try to initialize now (lazy init for post-onboarding)
  if (!isAgentInitialized) {
    console.log('[Agent] Not initialized, attempting lazy initialization...')
    const initialized = await tryInitializeAgent()
    if (!initialized) {
      console.error('[Agent] Lazy initialization failed')
      const error = serializeTaskError(initializationError ?? new ProcessorNotInitError())
      transportClient?.request('task:error', {error, taskId})
      return
    }

    console.log('[Agent] Lazy initialization successful!')
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
      console.log(`[Agent] ${reason}, reinitializing...`)

      const reinitialized = await tryInitializeAgent(true)
      if (!reinitialized) {
        console.error('[Agent] Reinitialization with new config failed')
        const error = serializeTaskError(initializationError ?? new ProcessorNotInitError())
        transportClient?.request('task:error', {error, taskId})
        return
      }

      console.log('[Agent] Reinitialization successful!')
    }
  }

  if (!taskProcessor) {
    console.error('[Agent] TaskProcessor not initialized')
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
    await taskProcessor.process({
      content: input,
      files,
      taskId,
      type,
    })

    // Notify completion
    console.log(`[Agent] Task completed: ${taskId}`)
    transportClient?.request('task:completed', {taskId}).catch(() => {})
  } catch (error) {
    const errorData = serializeTaskError(error)
    console.error(`[Agent] Task error: ${taskId} - [${errorData.name}] ${errorData.message}`)
    transportClient?.request('task:error', {error: errorData, taskId}).catch(() => {})
  } finally {
    currentTaskId = undefined
  }
}

/**
 * Handle task:cancel from Transport.
 */
function handleTaskCancel(data: TaskCancelMessage): void {
  const {taskId} = data
  console.log(`[Agent] Cancelling task: ${taskId}`)
  taskProcessor?.cancel(taskId)
}

/**
 * Start Agent Process.
 */
async function startAgent(): Promise<void> {
  const port = getTransportPort()
  console.log(`[Agent] Connecting to Transport on port ${port}`)

  // Create Transport client
  transportClient = createTransportClient()

  // Connect to Transport
  await transportClient.connect(`http://localhost:${port}`)
  console.log('[Agent] Connected to Transport')

  // Register as Agent
  await transportClient.request('agent:register', {})
  console.log('[Agent] Registered with Transport')

  // Try to initialize agent (may fail if no auth yet - that's OK, will lazy init later)
  const initialized = await tryInitializeAgent()
  if (!initialized) {
    console.log('[Agent] Initial setup incomplete - will retry when tasks arrive (lazy init)')
  }

  // Setup event handlers
  transportClient.on<TaskExecuteMessage>('task:execute', (data) => {
    handleTaskExecute(data).catch((error) => {
      console.error('[Agent] Task execution failed:', error)
      const errorData = serializeTaskError(error)
      transportClient?.request('task:error', {error: errorData, taskId: data.taskId}).catch(() => {})
    })
  })

  transportClient.on<TaskCancelMessage>('task:cancel', handleTaskCancel)

  // Handle shutdown from Transport
  transportClient.on('shutdown', () => {
    console.log('[Agent] Received shutdown from Transport')
    stopAgent().then(() => {
      sendToParent({type: 'stopped'})
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(0)
    })
  })

  console.log('[Agent] Ready to process tasks')
}

/**
 * Stop Agent Process.
 */
async function stopAgent(): Promise<void> {
  // Stop CipherAgent first
  if (cipherAgent) {
    await (cipherAgent as CipherAgent).stop()
    cipherAgent = undefined
    console.log('[Agent] CipherAgent stopped')
  }

  if (transportClient) {
    await transportClient.disconnect()
    transportClient = undefined
  }

  taskProcessor = undefined
  console.log('[Agent] Stopped')
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
    console.error('[Agent] Failed to start:', message)
    sendToParent({error: message, type: 'error'})
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  // IPC message handler
  process.on('message', async (msg: IPCMessage) => {
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
  console.error('[Agent] Fatal error:', error)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
