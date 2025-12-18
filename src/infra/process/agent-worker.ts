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

import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'
import type {ToolCallInfo, ToolResultInfo} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {
  NoOpProjectConfigStore,
  NoOpTerminal,
  NoOpTokenStore,
  NoOpTrackingService,
} from '../../core/interfaces/noop-implementations.js'
import {createTaskProcessor, TaskProcessor} from '../core/task-processor.js'
import {createTransportClient} from '../transport/transport-factory.js'
import {CurateUseCase} from '../usecase/curate-use-case.js'
import {QueryUseCase} from '../usecase/query-use-case.js'

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
  fileReferenceInstructions?: string
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
 * Create UseCase dependencies (NoOp for headless mode).
 */
function createUseCaseDependencies() {
  return {
    projectConfigStore: new NoOpProjectConfigStore(),
    terminal: new NoOpTerminal(),
    tokenStore: new NoOpTokenStore(),
    trackingService: new NoOpTrackingService(),
  }
}

/**
 * Handle task:execute from Transport.
 */
async function handleTaskExecute(data: TaskExecuteMessage): Promise<void> {
  const {fileReferenceInstructions, input, taskId, type} = data

  console.log(`[Agent] Processing task: ${taskId} (type=${type})`)

  if (!taskProcessor) {
    console.error('[Agent] TaskProcessor not initialized')
    transportClient?.request('task:error', {error: 'TaskProcessor not initialized', taskId})
    return
  }

  // Process task with streaming callbacks
  await taskProcessor.process(
    {
      content: input,
      fileReferenceInstructions,
      taskId,
      type,
    },
    {
      onChunk(content: string) {
        transportClient?.request('task:chunk', {content, taskId}).catch(() => {})
      },
      onCompleted(result: string) {
        console.log(`[Agent] Task completed: ${taskId}`)
        transportClient?.request('task:completed', {result, taskId}).catch(() => {})
      },
      onError(error: string) {
        console.error(`[Agent] Task error: ${taskId} - ${error}`)
        transportClient?.request('task:error', {error, taskId}).catch(() => {})
      },
      onStarted() {
        transportClient?.request('task:started', {taskId}).catch(() => {})
      },
      onToolCall(info: ToolCallInfo) {
        transportClient?.request('task:toolCall', {...info, taskId}).catch(() => {})
      },
      onToolResult(info: ToolResultInfo) {
        transportClient?.request('task:toolResult', {...info, taskId}).catch(() => {})
      },
    },
  )
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

  // Create UseCases
  const deps = createUseCaseDependencies()
  const curateUseCase = new CurateUseCase(deps)
  const queryUseCase = new QueryUseCase(deps)

  // Create TaskProcessor
  taskProcessor = createTaskProcessor({
    curateUseCase,
    queryUseCase,
  })

  // Setup event handlers
  transportClient.on<TaskExecuteMessage>('task:execute', (data) => {
    handleTaskExecute(data).catch((error) => {
      console.error('[Agent] Task execution failed:', error)
      transportClient
        ?.request('task:error', {
          error: error instanceof Error ? error.message : String(error),
          taskId: data.taskId,
        })
        .catch(() => {})
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
