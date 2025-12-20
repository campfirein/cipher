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
import {
  NotAuthenticatedError,
  ProcessorNotInitError,
  ProjectNotInitError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'
import {NoOpTerminal, NoOpTrackingService} from '../../core/interfaces/noop-implementations.js'
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
 * Create UseCase dependencies.
 * Uses real stores for auth/config, NoOp for terminal/tracking (headless mode).
 */
function createUseCaseDependencies() {
  return {
    projectConfigStore: new ProjectConfigStore(),
    terminal: new NoOpTerminal(),
    tokenStore: new KeychainTokenStore(),
    trackingService: new NoOpTrackingService(),
  }
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
 * Handle task:execute from Transport.
 */
async function handleTaskExecute(data: TaskExecuteMessage): Promise<void> {
  const {files, input, taskId, type} = data

  console.log(`[Agent] Processing task: ${taskId} (type=${type})`)

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

  // Create V2 UseCases (pure execution, no dependencies)
  const curateUseCase = new CurateUseCaseV2()
  const queryUseCase = new QueryUseCaseV2()

  // Load auth token and config for CipherAgent
  const tokenStore = new KeychainTokenStore()
  const configStore = new ProjectConfigStore()

  const authToken = await tokenStore.load()
  const brvConfig = await configStore.read()

  if (!authToken) {
    throw new NotAuthenticatedError()
  }

  if (!brvConfig) {
    throw new ProjectNotInitError()
  }

  // Create CipherAgent (v0.5.0: single agent per process)
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

  const agent = new CipherAgent(agentConfig, brvConfig)
  await agent.start()
  console.log('[Agent] CipherAgent started')

  // Create ChatSession ONCE when agent starts (used for all tasks)
  chatSessionId = `agent-session-${randomUUID()}`
  await agent.createSession(chatSessionId)
  console.log(`[Agent] ChatSession created: ${chatSessionId}`)

  // Setup event forwarding BEFORE processing any tasks
  setupAgentEventForwarding(agent)
  cipherAgent = agent

  // Create TaskProcessor and inject agent
  taskProcessor = createTaskProcessor({
    curateUseCase,
    queryUseCase,
  })
  taskProcessor.setAgent(cipherAgent)

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
