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
 * - Receives: 'ping', 'shutdown', 'health-check'
 * - Sends: 'ready', 'pong', 'stopped', 'error', 'health-check-result'
 *
 * Socket.IO events (as client):
 * - Sends: 'agent:register' (identify as Agent)
 * - Receives: 'task:execute', 'task:cancel', 'shutdown'
 * - Sends: 'task:started', 'task:chunk', 'task:completed', 'task:error', 'task:toolCall', 'task:toolResult'
 */

import {type AgentStatus, type ITransportClient, TransportClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'

import type {AgentEventMap} from '../../../agent/core/domain/agent-events/types.js'
import type {TaskCancel, TaskExecute} from '../../core/domain/transport/schemas.js'
import type {AgentIPCResponse, IPCCommand} from './ipc-types.js'

import {AgentConfig, CipherAgent} from '../../../agent/infra/agent/index.js'
import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {FolderPackService} from '../../../agent/infra/folder-pack/folder-pack-service.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'
import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {
  AgentNotInitializedError,
  NotAuthenticatedError,
  ProcessorNotInitError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'
import {agentLog} from '../../utils/process-logger.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {CurateExecutor} from '../executor/curate-executor.js'
import {FolderPackExecutor} from '../executor/folder-pack-executor.js'
import {QueryExecutor} from '../executor/query-executor.js'
import {createTaskProcessor, TaskProcessor} from '../executor/task-processor.js'
import {FileProviderConfigStore} from '../storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../storage/provider-keychain-store.js'
import {createTokenStore} from '../storage/token-store.js'
import {createParentHeartbeat} from './parent-heartbeat.js'
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

/**
 * Send a critical transport event with retry logic.
 * Uses exponential backoff for retries to handle transient network issues.
 * Inspired by opencode's robust event forwarding pattern.
 *
 * Critical events include: task:completed, task:error, task:cancelled
 * These should be retried because if they fail, TUI won't know the task ended.
 *
 * @param eventName - The event name to send
 * @param data - The event payload
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 */
function sendCriticalEvent(eventName: string, data: unknown, maxRetries = 3): void {
  const BASE_DELAY_MS = 100

  const attemptSend = (attempt: number): void => {
    transportClient
      ?.requestWithAck(eventName, data)
      .then(() => {
        // Success - nothing more to do
      })
      .catch((error: unknown) => {
        const isLastAttempt = attempt >= maxRetries
        const message = error instanceof Error ? error.message : String(error)

        if (isLastAttempt) {
          agentLog(`Critical event ${eventName} failed after ${maxRetries + 1} attempts: ${message}`)
          return
        }

        // Retry with exponential backoff
        const delay = BASE_DELAY_MS * 2 ** attempt
        agentLog(
          `Critical event ${eventName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${message}`,
        )
        setTimeout(() => attemptSend(attempt + 1), delay)
      })
  }

  attemptSend(0)
}

// Task types imported from core/domain/transport/schemas.ts:
// - TaskExecute: Transport → Agent (task:execute event)
// - TaskCancel: Transport → Agent (task:cancel event)

// ============================================================================
// Agent Process
// ============================================================================

let transportClient: ITransportClient | undefined
let taskProcessor: TaskProcessor | undefined
let cipherAgent: CipherAgent | undefined

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

/** Parent heartbeat monitor - lazily initialized in runWorker() */
let parentHeartbeat: ReturnType<typeof createParentHeartbeat> | undefined

// ============================================================================
// Credentials Polling (detects auth/config changes)
// ============================================================================

/**
 * Credentials polling interval in milliseconds.
 *
 * 5 seconds balances:
 * - Responsiveness: User expects agent to react within ~5s after login/logout/space switch
 * - Efficiency: Polling every 5s has minimal CPU/IO overhead (reads 2 small files)
 * - UX: Faster than explicit restart, acceptable latency for credential changes
 */
const CREDENTIALS_POLL_INTERVAL_MS = 5000

/** Cached credentials for change detection */
interface CachedCredentials {
  accessToken: string
  sessionKey: string
  spaceId: string | undefined
  teamId: string | undefined
}

/** Current cached credentials (set after successful init) */
let cachedCredentials: CachedCredentials | undefined

/** Guard: prevent concurrent polling checks */
let isPolling = false

/** Credentials polling running flag */
let credentialsPollingRunning = false

/** Guard: prevent task enqueueing during reinit (fixes TOCTOU race condition) */
let isReinitializing = false

/**
 * Lazy-initialized stores for credentials polling.
 * Avoids side effects at import time (file system access).
 * Created once on first poll, then reused (avoid creating new instances every 5 seconds).
 */
let pollingTokenStore: ReturnType<typeof createTokenStore> | undefined
let pollingConfigStore: ProjectConfigStore | undefined

function getPollingStores(): {
  pollingConfigStore: ProjectConfigStore
  pollingTokenStore: ReturnType<typeof createTokenStore>
} {
  pollingTokenStore ??= createTokenStore()
  pollingConfigStore ??= new ProjectConfigStore()
  return {pollingConfigStore, pollingTokenStore}
}

/**
 * Stored event forwarder references for cleanup on reinit.
 * Prevents memory leaks from accumulating listeners.
 *
 * The handler type matches BaseTypedEventEmitter's fallback signature:
 * `on(eventName: string | symbol, listener: (data?: unknown) => void): this`
 */
type EventForwarder = {
  event: string
  handler: (data?: unknown) => void
}
let eventForwarders: EventForwarder[] = []

// ============================================================================
// Task Queue Manager (replaces inline queue logic)
// ============================================================================

/**
 * Task queue manager handles:
 * - Unified queue for all task types (curate, query)
 * - Sequential FIFO execution (max 1 concurrent)
 * - Task deduplication (same taskId can't be queued twice)
 * - Cancel tasks from queue before processing
 */
const taskQueueManager = new TaskQueueManager({
  maxConcurrent: 1, // Sequential FIFO execution for all tasks
  onExecutorError(taskId, error) {
    agentLog(`Executor error for task ${taskId}: ${error}`)
  },
})

/**
 * Notify clients about dropped tasks and clear the queue.
 * Extracted to avoid DRY violation across reinit, stop, and shutdown paths.
 */
function notifyQueuedTasksAboutDropAndClear(reason: string): void {
  const queuedTasks = taskQueueManager.getQueuedTasks()
  if (queuedTasks.length > 0) {
    const error = serializeTaskError(new AgentNotInitializedError(`Task dropped - ${reason}`))
    if (transportClient) {
      agentLog(`Notifying ${queuedTasks.length} queued task(s): ${reason}`)
      for (const task of queuedTasks) {
        transportClient.requestWithAck('task:error', {error, taskId: task.taskId}).catch(logTransportError)
      }
    } else {
      agentLog(`Cannot notify ${queuedTasks.length} queued task(s): no transport client`)
    }
  }

  taskQueueManager.clear()
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
 * Cleanup event forwarders from previous agent instance.
 * Prevents memory leaks when agent is reinitialized.
 */
function cleanupAgentEventForwarding(): void {
  if (eventForwarders.length === 0) {
    return
  }

  // Get the old agent's event bus (if still available)
  const eventBus = cipherAgent?.agentEventBus
  if (eventBus) {
    for (const {event, handler} of eventForwarders) {
      // Uses fallback signature: off(eventName: string, listener: (data?: unknown) => void)
      eventBus.off(event, handler)
    }
  }

  // Clear the stored references
  eventForwarders = []
  agentLog('Event forwarders cleaned up')
}

/**
 * Check if there is pending work that would be disrupted by reinit.
 * Returns true if tasks are active (running) OR queued (waiting).
 */
function hasPendingWork(): boolean {
  return taskQueueManager.hasActiveTasks() || taskQueueManager.getQueuedCount() > 0
}

/**
 * Wait for active tasks to complete with a timeout.
 * Used before reinit to allow in-flight tasks to finish gracefully.
 */
async function waitForActiveTasksToComplete(timeoutMs: number): Promise<void> {
  const start = Date.now()
  const checkInterval = 100

  // Poll until no active tasks or timeout
  const pollUntilDone = async (): Promise<void> => {
    while (taskQueueManager.hasActiveTasks()) {
      if (Date.now() - start >= timeoutMs) {
        agentLog('Timeout waiting for active tasks - proceeding with reinit')
        return
      }

      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        setTimeout(resolve, checkInterval)
      })
    }

    agentLog('Task queue drained successfully')
  }

  await pollUntilDone()
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

  // Helper to register and track event forwarder.
  // Wraps typed handler to match event bus fallback signature.
  const registerForwarder = <T>(event: string, handler: (payload: T) => void): void => {
    // Wrapper matches fallback: (data?: unknown) => void
    // BOUNDARY CAST: Event bus delivers unknown data; handler expects T.
    // Type guard not possible for generic T at runtime.
    const wrappedHandler = (data?: unknown): void => {
      handler(data as T)
    }

    // Uses fallback signature: on(eventName: string, listener: (data?: unknown) => void)
    eventBus.on(event, wrappedHandler)
    eventForwarders.push({event, handler: wrappedHandler})
  }

  // Forward llmservice:thinking
  registerForwarder('llmservice:thinking', (payload: AgentEventMap['llmservice:thinking']) => {
    if (payload.taskId) {
      transportClient
        ?.requestWithAck('llmservice:thinking', {sessionId: payload.sessionId, taskId: payload.taskId})
        .catch(logTransportError)
    }
  })

  // Forward llmservice:chunk
  registerForwarder('llmservice:chunk', (payload: AgentEventMap['llmservice:chunk']) => {
    if (payload.taskId) {
      transportClient
        ?.requestWithAck('llmservice:chunk', {
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
        ?.requestWithAck('llmservice:response', {
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
        ?.requestWithAck('llmservice:toolCall', {
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
        ?.requestWithAck('llmservice:toolResult', {
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
        ?.requestWithAck('llmservice:error', {
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
        ?.requestWithAck('llmservice:unsupportedInput', {
          reason: payload.reason,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
        })
        .catch(logTransportError)
    }
  })

  agentLog(`Event forwarding setup complete (${eventForwarders.length} forwarders registered)`)
}

/** Task execution timeout: 5 minutes */
const TASK_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Setup the task executor for TaskQueueManager.
 * Fix #2: Now called unconditionally at startup (before tryInitializeAgent).
 * Lazy init inside executor enables processing tasks even if initial init failed.
 */
function setupTaskExecutor(): void {
  taskQueueManager.setExecutor(async (task: TaskExecute) => {
    const {taskId, type} = task
    const stats = taskQueueManager.getStats()
    agentLog(`Processing task ${taskId} (${type}), ${stats.queued} queued, ${stats.active} active`)

    // Fix #2: Lazy initialization - if agent not ready, try to initialize now
    // This enables processing tasks that arrived while init was failing
    if (!isAgentInitialized) {
      agentLog(`Task ${taskId} - agent not initialized, attempting lazy init...`)
      const initialized = await tryInitializeAgent()
      if (!initialized) {
        agentLog(`Task ${taskId} rejected - lazy initialization failed`)
        const error = serializeTaskError(
          initializationError ?? new AgentNotInitializedError('Agent initialization failed'),
        )
        sendCriticalEvent('task:error', {error, taskId})
        return
      }

      agentLog(`Task ${taskId} - lazy initialization successful, proceeding`)
    }

    // Pre-execution guard: Verify agent is still ready (catches race conditions)
    // This catches the case where credentials polling stopped the agent
    // between when lazy init succeeded and when execution starts.
    if (!isAgentInitialized || !taskProcessor) {
      agentLog(`Task ${taskId} rejected - agent stopped during queue wait`)
      const error = serializeTaskError(new AgentNotInitializedError('Agent stopped during execution wait'))
      sendCriticalEvent('task:error', {error, taskId})
      return
    }

    // Track timeout state for error handling
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      agentLog(`Task ${taskId} timed out after 5 minutes - cancelling via CipherAgent`)
      // Cancel via CipherAgent's existing cancel() method
      // This aborts activeStreamControllers and session, causing generate() to throw
      if (cipherAgent) {
        cipherAgent.cancel().catch((error) => {
          agentLog(`Error cancelling CipherAgent on timeout: ${error}`)
        })
      }
    }, TASK_EXECUTION_TIMEOUT_MS)

    try {
      // Execute task - if timeout fires, cipherAgent.cancel() will cause this to throw
      await handleTaskExecute(task)
    } catch (error) {
      // Handle timeout-triggered cancellation
      if (timedOut) {
        agentLog(`Task ${taskId} cancelled due to timeout`)
        const errorData = serializeTaskError(new Error('Task exceeded 5 minute timeout'))
        sendCriticalEvent('task:error', {error: errorData, taskId})
        return
      }

      // Handle other errors (not timeout)
      agentLog(`Task execution failed: ${error}`)
      const errorData = serializeTaskError(error)
      sendCriticalEvent('task:error', {error: errorData, taskId})
    } finally {
      // Always clear timeout to prevent memory leak
      clearTimeout(timeoutId)
    }
  })

  agentLog('Task executor setup complete')
}

/**
 * Timeout for CipherAgent initialization operations.
 * This prevents isInitializing flag from getting stuck if agent.start() or createSession() hangs.
 * ProcessManager has 30s timeout for startup, but runtime reinit needs its own protection.
 */
const AGENT_INIT_TIMEOUT_MS = 30_000

/**
 * Helper to wrap a promise with a timeout.
 * Throws an error if the operation doesn't complete within the timeout.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Validate auth token for initialization.
 * Returns the token if valid, undefined if invalid (also sets initializationError).
 */
function validateAuthToken(
  authToken: Awaited<ReturnType<ReturnType<typeof createTokenStore>['load']>>,
): typeof authToken {
  if (!authToken) {
    initializationError = new NotAuthenticatedError()
    agentLog('Cannot initialize - no auth token')
    return undefined
  }

  if (authToken.isExpired()) {
    initializationError = new NotAuthenticatedError()
    agentLog('Cannot initialize - token expired (please run /login to re-authenticate)')
    return undefined
  }

  return authToken
}

/**
 * Check if cleanup started during init and abort if so.
 * Returns true if should abort (cleanup started), false otherwise.
 */
async function shouldAbortInitForCleanup(agent: CipherAgent, phase: string): Promise<boolean> {
  if (isCleaningUp) {
    agentLog(`Cleanup started during ${phase}, aborting`)
    await agent.stop()
    return true
  }

  return false
}

/**
 * Stop a pending agent that was created but not yet assigned to cipherAgent.
 * Used in catch block when timeout/error occurs during agent.start() or createSession().
 */
async function stopPendingAgent(agent: CipherAgent | undefined): Promise<void> {
  if (!agent) return

  try {
    await agent.stop()
  } catch (stopError) {
    agentLog(`Error stopping pending agent: ${stopError}`)
  }
}

/**
 * Stop existing agent during force reinit.
 */
async function stopExistingAgentForReinit(): Promise<void> {
  if (!cipherAgent) return

  agentLog('Reinitializing with new config...')
  try {
    await cipherAgent.stop()
  } catch (error) {
    agentLog(`Error stopping previous agent: ${error}`)
  }

  cipherAgent = undefined
  taskProcessor = undefined
  isAgentInitialized = false
}

/**
 * Prepare for reinitialization by draining queue and stopping existing agent.
 *
 * NOTE: We do NOT cleanup transport event handlers here because they are meant
 * to be long-lived for the entire worker process lifecycle. Only agent event
 * forwarders (which are tied to the CipherAgent instance) are cleaned up via
 * cleanupAgentEventForwarding() in stopExistingAgentForReinit().
 */
async function prepareForReinit(): Promise<void> {
  // Drain task queue before reinit to prevent tasks executing with stale processor
  agentLog('Draining task queue before reinit...')
  notifyQueuedTasksAboutDropAndClear('credential/config change')

  // Wait for active tasks to complete (with timeout)
  await waitForActiveTasksToComplete(10_000)

  await stopExistingAgentForReinit()
}

/**
 * Provider configuration result from loading.
 */
interface ProviderConfiguration {
  modelFromProvider: string | undefined
  openRouterApiKey: string | undefined
  provider: string | undefined
  providerApiKey: string | undefined
  providerBaseUrl: string | undefined
  providerHeaders: Record<string, string> | undefined
  providerLocation: string | undefined
  providerProject: string | undefined
}

/**
 * Load provider configuration and return API key, model, and provider-specific config.
 */
async function loadProviderConfiguration(): Promise<ProviderConfiguration> {
  const {getProviderById} = await import('../../core/domain/entities/provider-registry.js')
  const {getProviderApiKeyFromEnv} = await import('../provider/env-provider-detector.js')

  const providerConfigStore = new FileProviderConfigStore()
  const providerKeychainStore = new ProviderKeychainStore()
  const providerConfig = await providerConfigStore.read()
  const activeProviderId = providerConfig.activeProvider

  const result: ProviderConfiguration = {
    modelFromProvider: undefined,
    openRouterApiKey: undefined,
    provider: undefined,
    providerApiKey: undefined,
    providerBaseUrl: undefined,
    providerHeaders: undefined,
    providerLocation: undefined,
    providerProject: undefined,
  }

  if (activeProviderId === 'byterover') {
    return result
  }

  // Get API key: keychain first, then environment variable
  let apiKey = await providerKeychainStore.getApiKey(activeProviderId)
  if (!apiKey) {
    apiKey = getProviderApiKeyFromEnv(activeProviderId)
  }

  // Get model from provider config
  const modelFromProvider = await providerConfigStore.getActiveModel(activeProviderId)
  result.modelFromProvider = modelFromProvider

  // Vertex AI uses Application Default Credentials, not API keys
  if (activeProviderId === 'google-vertex') {
    result.provider = activeProviderId
    result.providerProject = process.env.GOOGLE_CLOUD_PROJECT || undefined
    result.providerLocation = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
    agentLog(
      `Using external provider: ${activeProviderId} (project: ${result.providerProject ?? 'default'}, location: ${result.providerLocation})${modelFromProvider ? ` with model: ${modelFromProvider}` : ''}`,
    )

    return result
  }

  if (!apiKey) {
    agentLog(`No API key found for provider: ${activeProviderId}`)

    return result
  }

  // Route based on provider type
  const providerDef = getProviderById(activeProviderId)

  if (activeProviderId === 'openrouter') {
    // Backward compatible: use openRouterApiKey field
    result.openRouterApiKey = apiKey
  } else {
    // Direct provider: pass provider-specific config
    result.provider = activeProviderId
    result.providerApiKey = apiKey
    result.providerBaseUrl = providerDef?.baseUrl || undefined
    const headers = providerDef?.headers
    result.providerHeaders = headers && Object.keys(headers).length > 0 ? {...headers} : undefined
  }

  agentLog(
    `Using external provider: ${activeProviderId}${modelFromProvider ? ` with model: ${modelFromProvider}` : ''}`,
  )

  return result
}

/**
 * Build agent configuration object from auth token and provider settings.
 */
function buildAgentConfig(
  authToken: Awaited<ReturnType<ReturnType<typeof createTokenStore>['load']>> & {
    accessToken: string
    sessionKey: string
  },
  providerConfig: ProviderConfiguration,
): AgentConfig {
  const envConfig = getCurrentConfig()
  return {
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
    model: providerConfig.modelFromProvider ?? DEFAULT_LLM_MODEL,
    openRouterApiKey: providerConfig.openRouterApiKey,
    projectId: PROJECT,
    provider: providerConfig.provider,
    providerApiKey: providerConfig.providerApiKey,
    providerBaseUrl: providerConfig.providerBaseUrl,
    providerHeaders: providerConfig.providerHeaders,
    providerLocation: providerConfig.providerLocation,
    providerProject: providerConfig.providerProject,
    sessionKey: authToken.sessionKey,
  }
}

/**
 * Initialize agent instance by starting it and creating a session.
 * Returns the initialized agent or undefined if cleanup was triggered.
 */
async function initializeAgentInstance(agent: CipherAgent): Promise<CipherAgent | undefined> {
  // Wrap agent.start() with timeout to prevent isInitializing from getting stuck
  await withTimeout(agent.start(), AGENT_INIT_TIMEOUT_MS, 'CipherAgent.start()')
  agentLog('CipherAgent started')

  // Check if cleanup started during agent.start() (fixes zombie agent race)
  if (await shouldAbortInitForCleanup(agent, 'agent.start()')) {
    return undefined
  }

  // Create ChatSession (also with timeout to prevent hanging)
  chatSessionId = `agent-session-${randomUUID()}`
  await withTimeout(agent.createSession(chatSessionId), AGENT_INIT_TIMEOUT_MS, 'CipherAgent.createSession()')
  agentLog(`ChatSession created: ${chatSessionId}`)

  // Check if cleanup started during createSession() (fixes zombie agent race)
  if (await shouldAbortInitForCleanup(agent, 'createSession()')) {
    return undefined
  }

  return agent
}

/**
 * Finalize agent initialization by setting up event forwarding, creating task processor,
 * and updating cached credentials.
 */
function finalizeAgentInitialization(params: {
  agent: CipherAgent
  authToken: Awaited<ReturnType<ReturnType<typeof createTokenStore>['load']>> & {
    accessToken: string
    sessionKey: string
  }
  brvConfig: Awaited<ReturnType<ProjectConfigStore['read']>>
  curateExecutor: CurateExecutor
  folderPackExecutor: FolderPackExecutor
  queryExecutor: QueryExecutor
}): void {
  const {agent, authToken, brvConfig, curateExecutor, folderPackExecutor, queryExecutor} = params

  // Setup event forwarding
  setupAgentEventForwarding(agent)
  cipherAgent = agent

  // Create TaskProcessor
  taskProcessor = createTaskProcessor({
    curateExecutor,
    folderPackExecutor,
    queryExecutor,
  })
  taskProcessor.setAgent(cipherAgent)

  // NOTE: setupTaskExecutor() is called once in startAgent() before tryInitializeAgent()
  // No need to call again here - executor is already set and handles lazy init

  // Mark as initialized
  isAgentInitialized = true
  initializationError = undefined

  // Cache credentials for change detection polling
  updateCachedCredentials(
    authToken.accessToken,
    authToken.sessionKey,
    brvConfig ? {spaceId: brvConfig.spaceId, teamId: brvConfig.teamId} : undefined,
  )

  if (brvConfig) {
    agentLog(`Fully initialized with auth and config (team=${brvConfig.teamId}, space=${brvConfig.spaceId})`)
  } else {
    agentLog('Initialized with auth only (no project config yet - will reinit when config available)')
  }

  // Broadcast status change to Transport (init success)
  broadcastStatusChange()
}

/**
 * Try to initialize/reinitialize the CipherAgent.
 * Called on startup and lazily when tasks arrive but agent is not initialized.
 * This handles the case where user completes onboarding after agent starts.
 *
 * @param forceReinit - Force reinitialization even if already initialized (for config reload)
 */
async function tryInitializeAgent(forceReinit = false): Promise<boolean> {
  // Guard: prevent initialization during cleanup or if already in progress
  if (isCleaningUp || isInitializing) {
    agentLog('Initialization blocked (cleanup or already in progress)')
    // Clear isReinitializing if WE set it (forceReinit case)
    // Without this, the flag would be stuck forever since we return before try block
    // and thus finally block never runs. Next poll will re-detect and retry.
    if (forceReinit) {
      isReinitializing = false
    }

    return false
  }

  // Already initialized and not forcing reinit
  if (!forceReinit && isAgentInitialized && cipherAgent && taskProcessor) {
    return true
  }

  isInitializing = true

  // Set isReinitializing flag for forceReinit to reject tasks during reinit
  // Note: caller (pollCredentialsAndSync) may have already set this - that's OK, we'll clear in finally
  if (forceReinit) {
    isReinitializing = true
  }

  // Declare outside try block so catch can cleanup on timeout/error
  let pendingAgent: CipherAgent | undefined

  try {
    // If forcing reinit, drain queue and stop existing agent first
    if (forceReinit) {
      await prepareForReinit()
    }

    const tokenStore = createTokenStore()
    const configStore = new ProjectConfigStore()

    const rawToken = await tokenStore.load()
    const brvConfig = await configStore.read()

    // Validate auth token (sets initializationError if invalid)
    const authToken = validateAuthToken(rawToken)
    if (!authToken) {
      return false
    }

    // Create Executors
    const curateExecutor = new CurateExecutor()

    // Create shared FileSystemService (used by FolderPackExecutor and QueryExecutor)
    const fileSystemService = new FileSystemService()
    await fileSystemService.initialize()

    // Create QueryExecutor with smart routing and caching dependencies
    const searchService = createSearchKnowledgeService(fileSystemService)
    const queryExecutor = new QueryExecutor({
      enableCache: true,
      fileSystem: fileSystemService,
      searchService,
    })
    const folderPackService = new FolderPackService(fileSystemService)
    await folderPackService.initialize()
    const folderPackExecutor = new FolderPackExecutor(folderPackService)

    // Read provider configuration
    const providerConfig = await loadProviderConfiguration()

    // Build agent configuration
    const agentConfig = buildAgentConfig(authToken, providerConfig)

    // Initialize agent instance
    pendingAgent = new CipherAgent(agentConfig, brvConfig ?? undefined)
    const initializedAgent = await initializeAgentInstance(pendingAgent)
    if (!initializedAgent) {
      return false
    }

    // Finalize initialization
    finalizeAgentInitialization({
      agent: initializedAgent,
      authToken,
      brvConfig,
      curateExecutor,
      folderPackExecutor,
      queryExecutor,
    })
    pendingAgent = undefined // Clear local ref - cipherAgent now owns it

    return true
  } catch (error) {
    // Stop pendingAgent if it was created but not yet assigned to cipherAgent
    // This handles timeout/error during agent.start() or createSession()
    await stopPendingAgent(pendingAgent)
    pendingAgent = undefined

    // Cleanup partial state before recording error
    // This prevents stale refs from accumulating on repeated failures
    await cleanupPartialInit()

    // Catch errors and return false instead of throwing
    // This allows lazy init to retry when tasks arrive
    initializationError = error instanceof Error ? error : new Error(String(error))
    agentLog(`Agent initialization failed: ${error}`)

    // Broadcast status change to Transport (init failed)
    broadcastStatusChange()

    return false
  } finally {
    isInitializing = false
    // Clear isReinitializing flag (matches the set above for forceReinit)
    if (forceReinit) {
      isReinitializing = false
    }
  }
}

/**
 * Handle task:execute from Transport.
 */
async function handleTaskExecute(data: TaskExecute): Promise<void> {
  const {clientCwd, content, files, folderPath, taskId, type} = data

  agentLog(`Processing task: ${taskId} (type=${type})`)

  // NOTE: Lazy initialization is handled in setupTaskExecutor() executor callback.
  // By the time we reach here, agent is already initialized (executor does lazy init first).

  if (!taskProcessor) {
    agentLog('TaskProcessor not initialized')
    const error = serializeTaskError(new ProcessorNotInitError())
    sendCriticalEvent('task:error', {error, taskId})
    return
  }

  // Notify task started - use sendCriticalEvent for reliability
  sendCriticalEvent('task:started', {taskId})

  try {
    // Process task - events stream via agentEventBus subscription
    // Response is forwarded via llmservice:response event (no manual send needed)
    // Agent uses its default session (Single-Session pattern)
    // File validation is handled by UseCase (business logic belongs there)
    // Note: taskId is passed to UseCase → CipherAgent → ChatSession, which adds it to all events
    const result = await taskProcessor.process({
      clientCwd,
      content,
      files,
      folderPath,
      taskId,
      type,
    })

    // Notify completion with result (required by TaskCompletedEventSchema)
    // Use sendCriticalEvent for retry logic - TUI must know task ended
    agentLog(`Task completed: ${taskId}`)
    sendCriticalEvent('task:completed', {result, taskId})
  } catch (error) {
    const errorData = serializeTaskError(error)
    agentLog(`Task error: ${taskId} - [${errorData.name}] ${errorData.message}`)
    // Use sendCriticalEvent for retry logic - TUI must know task ended
    sendCriticalEvent('task:error', {error: errorData, taskId})
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
      // Notify transport that task was cancelled - use retry for reliability
      sendCriticalEvent('task:cancelled', {taskId})
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

  // Create Transport client (low-level: worker connects to specific port, not via discovery)
  transportClient = new TransportClient()

  // Connect to Transport
  await transportClient.connect(`http://localhost:${port}`)
  agentLog('Connected to Transport')

  // Register as Agent
  await transportClient.requestWithAck('agent:register', {})
  agentLog('Registered with Transport')

  // Fix #1: Re-register on any reconnect (Socket.IO auto-reconnect OR force reconnect)
  // When connection is restored, agent needs to re-register with Transport.
  // Using onStateChange instead of 'connect' event to handle all reconnect types.
  // Fix #4: Include status in register payload to prevent race condition window
  let wasDisconnected = false
  transportClient.onStateChange(async (state) => {
    agentLog(`Transport state changed: ${state}`)
    if (state === 'disconnected' || state === 'reconnecting') {
      wasDisconnected = true
    } else if (state === 'connected' && wasDisconnected) {
      agentLog('Transport reconnected - re-registering with Transport')

      // Retry with exponential backoff (50ms, 100ms, 200ms, 400ms, 800ms)
      // Socket.IO may fire 'connected' state before socket is fully ready
      const retryDelays = [50, 100, 200, 400, 800]
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          // Include status in register payload (Transport caches it atomically)
          // eslint-disable-next-line no-await-in-loop -- Sequential retries with backoff required
          await transportClient?.requestWithAck('agent:register', {status: getAgentStatus()})
          // Only clear flag after successful registration
          wasDisconnected = false
          agentLog('Re-registered with Transport after reconnect')
          return // Success - exit retry loop
        } catch (error) {
          if (attempt < retryDelays.length) {
            agentLog(`Re-register attempt ${attempt + 1} failed, retrying in ${retryDelays[attempt]}ms: ${error}`)
            // eslint-disable-next-line no-await-in-loop -- Sequential retries with backoff required
            await new Promise<void>((resolve) => {
              setTimeout(resolve, retryDelays[attempt])
            })
          } else {
            // Keep wasDisconnected = true so next reconnect retries registration
            agentLog(`Failed to re-register after ${attempt + 1} attempts: ${error}`)
          }
        }
      }
    }
  })

  // Fix #2: Setup task executor BEFORE init - enables lazy init when tasks arrive
  // This ensures tasks don't get stuck in queue if initial init fails
  setupTaskExecutor()

  // Try to initialize agent (may fail if no auth yet - that's OK)
  // tryInitializeAgent() broadcasts status on both success and failure,
  // so Transport will have cached status before any task can arrive.
  // If init fails, lazy init will retry when tasks arrive (handled by executor).
  const initialized = await tryInitializeAgent()
  if (!initialized) {
    agentLog('Initial setup incomplete - will retry when tasks arrive (lazy init)')
  }

  // Setup event handlers - TaskQueueManager handles queueing and deduplication
  // These handlers are registered once and persist for the worker's lifetime
  transportClient.on<TaskExecute>('task:execute', (data) => {
    // Reject tasks during reinit to prevent TOCTOU race condition
    if (isReinitializing) {
      agentLog(`Task ${data.taskId} rejected - agent reinitializing`)
      const error = serializeTaskError(new AgentNotInitializedError('Agent is reinitializing'))
      sendCriticalEvent('task:error', {error, taskId: data.taskId})
      return
    }

    const result = taskQueueManager.enqueue(data)

    if (result.success) {
      const stats = taskQueueManager.getStats()
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
    stopAgent()
      .then(() => {
        sendToParent({type: 'stopped'})
        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        process.exit(0)
      })
      .catch((error) => {
        agentLog(`Error during shutdown: ${error}`)
        sendToParent({type: 'stopped'})
        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        process.exit(1)
      })
  })

  // Handle agent:restart from Transport (triggered by client, e.g., after /init)
  transportClient.on<{reason?: string}>('agent:restart', async (data) => {
    agentLog(`Agent restart requested: ${data.reason ?? 'no reason'}`)

    // Guard: reject if initialization already in progress (prevents concurrent reinit race condition)
    if (isInitializing || isReinitializing) {
      agentLog('Agent restart rejected - initialization already in progress')
      await transportClient?.requestWithAck('agent:restarted', {
        error: 'Initialization already in progress',
        success: false,
      })
      return
    }

    // Reject restart if tasks are in progress or queued (prevents killing active tasks)
    if (hasPendingWork()) {
      agentLog('Agent restart rejected - tasks in progress or queued')
      await transportClient?.requestWithAck('agent:restarted', {
        error: 'Tasks in progress. Please wait for tasks to complete.',
        success: false,
      })
      return
    }

    try {
      // Reinitialize agent with fresh config
      const success = await tryInitializeAgent(true) // forceReinit = true

      if (success) {
        agentLog('Agent reinitialized successfully')
        // Notify Transport that restart completed
        await transportClient?.requestWithAck('agent:restarted', {success: true})
      } else if (isCleaningUp) {
        // Cleanup in progress - can't restart during shutdown
        agentLog('Agent reinitialization rejected - cleanup in progress')
        await transportClient?.requestWithAck('agent:restarted', {
          error: 'Agent is shutting down',
          success: false,
        })
      } else {
        // Actual failure - missing auth or config
        // Note: isInitializing is guaranteed to be false here because tryInitializeAgent()
        // always clears it in its finally block before returning
        agentLog('Agent reinitialization failed - config incomplete')
        await transportClient?.requestWithAck('agent:restarted', {
          error: initializationError?.message ?? 'Config incomplete (no auth token or config)',
          success: false,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      agentLog(`Agent reinitialization error: ${message}`)
      await transportClient?.requestWithAck('agent:restarted', {error: message, success: false})
    }
  })

  // Handle agent:newSession from Transport (triggered by /new command)
  transportClient.on<{reason?: string}>('agent:newSession', async (data) => {
    agentLog(`New session requested: ${data.reason ?? 'no reason'}`)

    try {
      if (!cipherAgent) {
        agentLog('Cannot create new session - agent not initialized')
        await transportClient?.requestWithAck('agent:newSessionCreated', {
          error: 'Agent not initialized',
          success: false,
        })
        return
      }

      // Generate new session ID
      const newSessionId = `agent-session-${randomUUID()}`

      // Create new session
      await cipherAgent.createSession(newSessionId)

      // Switch the agent's default session to the new one
      // This ensures execute()/generate()/stream() use the new session
      cipherAgent.switchDefaultSession(newSessionId)

      // Update the local session ID reference
      chatSessionId = newSessionId

      agentLog(`New session created: ${newSessionId}`)

      // Notify Transport that new session was created
      await transportClient?.requestWithAck('agent:newSessionCreated', {
        sessionId: newSessionId,
        success: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      agentLog(`New session creation error: ${message}`)
      await transportClient?.requestWithAck('agent:newSessionCreated', {
        error: message,
        success: false,
      })
    }
  })

  agentLog('Ready to process tasks')
}

// ============================================================================
// Credentials Polling Functions
// ============================================================================

/**
 * Stop CipherAgent only (does NOT exit process or disconnect transport).
 * Used when credentials are missing/invalid but we want to keep polling.
 */
async function stopCipherAgent(): Promise<void> {
  // Cleanup event forwarders
  cleanupAgentEventForwarding()

  // Notify and clear task queue (can't process without agent)
  notifyQueuedTasksAboutDropAndClear('agent stopped')

  // Stop CipherAgent
  if (cipherAgent) {
    try {
      await cipherAgent.stop()
    } catch (error) {
      agentLog(`Error stopping CipherAgent: ${error}`)
    }

    cipherAgent = undefined
  }

  taskProcessor = undefined
  chatSessionId = undefined
  isAgentInitialized = false
  cachedCredentials = undefined

  agentLog('CipherAgent stopped (credentials missing or invalid)')

  // Broadcast status change to Transport (cipher stopped)
  broadcastStatusChange()
}

/**
 * Cleanup partial state after failed initialization.
 * Called when tryInitializeAgent() fails partway through.
 * Does NOT broadcast status (caller handles that).
 */
async function cleanupPartialInit(): Promise<void> {
  agentLog('Cleaning up partial initialization state...')

  // Cleanup event forwarders (may have been partially set up)
  cleanupAgentEventForwarding()

  // Stop CipherAgent if it was partially started
  if (cipherAgent) {
    try {
      await cipherAgent.stop()
    } catch (error) {
      agentLog(`Error stopping partial CipherAgent: ${error}`)
    }

    cipherAgent = undefined
  }

  // Clear partial state
  taskProcessor = undefined
  chatSessionId = undefined
  // Note: DON'T clear cachedCredentials here - keep old credentials for comparison
  // Note: DON'T set isAgentInitialized - it should already be false

  agentLog('Partial initialization state cleaned up')
}

/**
 * Update cached credentials after successful initialization.
 */
function updateCachedCredentials(
  accessToken: string,
  sessionKey: string,
  config: undefined | {spaceId: string; teamId: string},
): void {
  cachedCredentials = {
    accessToken,
    sessionKey,
    spaceId: config?.spaceId,
    teamId: config?.teamId,
  }
}

/**
 * Check if credentials have changed compared to cache.
 */
function credentialsChanged(
  currentToken: undefined | {accessToken: string; sessionKey: string},
  currentConfig: undefined | {spaceId: string; teamId: string},
): 'changed' | 'missing' | 'unchanged' {
  // No cached credentials = first run or was stopped
  if (!cachedCredentials) {
    return currentToken ? 'changed' : 'missing'
  }

  // Token missing = credentials gone
  if (!currentToken) {
    return 'missing'
  }

  // Compare token
  if (
    currentToken.accessToken !== cachedCredentials.accessToken ||
    currentToken.sessionKey !== cachedCredentials.sessionKey
  ) {
    return 'changed'
  }

  // Compare config (spaceId/teamId)
  const currentSpaceId = currentConfig?.spaceId
  const currentTeamId = currentConfig?.teamId

  if (currentSpaceId !== cachedCredentials.spaceId || currentTeamId !== cachedCredentials.teamId) {
    return 'changed'
  }

  return 'unchanged'
}

/**
 * Poll credentials and sync CipherAgent state.
 *
 * Called periodically to detect auth/config changes:
 * - If credentials MISSING → stop CipherAgent
 * - If credentials CHANGED → reinit CipherAgent
 * - If UNCHANGED → do nothing
 */
async function pollCredentialsAndSync(): Promise<void> {
  // Guard: prevent concurrent polling
  if (isPolling) {
    return
  }

  // Guard: don't poll during cleanup or initialization
  if (isCleaningUp || isInitializing) {
    return
  }

  isPolling = true

  try {
    // Use lazy-initialized cached stores (avoid creating new instances every poll)
    const stores = getPollingStores()
    const authToken = await stores.pollingTokenStore.load()
    const brvConfig = await stores.pollingConfigStore.read()

    // Detect change
    const tokenInfo = authToken ? {accessToken: authToken.accessToken, sessionKey: authToken.sessionKey} : undefined
    const configInfo = brvConfig ? {spaceId: brvConfig.spaceId, teamId: brvConfig.teamId} : undefined

    const changeStatus = credentialsChanged(tokenInfo, configInfo)

    switch (changeStatus) {
      case 'changed': {
        // Check RIGHT BEFORE reinit - after all awaits, to catch tasks added during awaits
        // Must check BOTH active (running) AND queued tasks to prevent race condition
        // where task is enqueued after this check but before stopCipherAgent() clears taskProcessor
        if (hasPendingWork() || isReinitializing) {
          agentLog('Credentials changed but tasks in progress, queued, or reinit in progress - deferring')
          return
        }

        // Set flag IMMEDIATELY after check to close TOCTOU window
        // tryInitializeAgent will manage the flag from here (set on entry, clear in finally)
        isReinitializing = true

        // Credentials changed - reinit CipherAgent
        agentLog('Credentials changed - reinitializing CipherAgent')
        const success = await tryInitializeAgent(true) // forceReinit
        if (success) {
          agentLog('CipherAgent reinitialized with new credentials')
        } else {
          agentLog('CipherAgent reinitialization failed')
        }

        break
      }

      case 'missing': {
        // Credentials gone - stop CipherAgent if running
        if (isAgentInitialized) {
          if (hasPendingWork()) {
            agentLog('Credentials missing but tasks in progress - deferring stop')
            return
          }

          agentLog('Credentials missing - stopping CipherAgent')
          await stopCipherAgent()
        }

        break
      }

      case 'unchanged': {
        // No change - check if token expired (edge case)
        if (authToken?.isExpired() && isAgentInitialized) {
          if (hasPendingWork()) {
            agentLog('Token expired but tasks in progress - deferring stop')
            return
          }

          agentLog('Token expired - stopping CipherAgent')
          await stopCipherAgent()
        }

        break
      }
    }
  } catch (error) {
    // Don't crash on poll errors - just log and continue
    agentLog(`Credentials poll error: ${error}`)
  } finally {
    isPolling = false
  }
}

/**
 * Start credentials polling.
 * Uses recursive setTimeout pattern (same as parent heartbeat).
 */
function startCredentialsPolling(): void {
  if (credentialsPollingRunning) {
    return
  }

  credentialsPollingRunning = true

  const poll = (): void => {
    if (!credentialsPollingRunning) {
      return
    }

    pollCredentialsAndSync()
      .catch((error) => {
        agentLog(`Credentials poll failed: ${error}`)
      })
      .finally(() => {
        // Schedule next poll (only if still running)
        if (credentialsPollingRunning) {
          setTimeout(poll, CREDENTIALS_POLL_INTERVAL_MS)
        }
      })
  }

  // Start first poll after delay
  setTimeout(poll, CREDENTIALS_POLL_INTERVAL_MS)
  agentLog('Credentials polling started')
}

/**
 * Stop credentials polling.
 */
function stopCredentialsPolling(): void {
  credentialsPollingRunning = false
}

// ============================================================================
// Agent Status Reporting
// ============================================================================

/**
 * Get current agent status for health check.
 * Used by Transport to check if agent is ready before forwarding tasks.
 */
function getAgentStatus(): AgentStatus {
  return {
    activeTasks: taskQueueManager.getActiveCount(),
    hasAuth: cachedCredentials !== undefined,
    // Check both spaceId and teamId for safety (both must be set after /init)
    hasConfig: cachedCredentials?.spaceId !== undefined && cachedCredentials?.teamId !== undefined,
    isInitialized: isAgentInitialized,
    lastError: initializationError?.message,
    queuedTasks: taskQueueManager.getQueuedCount(),
  }
}

/**
 * Broadcast status change to Transport.
 * Called when cipher state changes (init success/fail, stop, credentials change).
 * Transport will forward to all connected clients.
 */
function broadcastStatusChange(): void {
  const status = getAgentStatus()
  transportClient?.requestWithAck('agent:status:changed', status).catch(logTransportError)
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
    // Stop polling and heartbeat first
    stopCredentialsPolling()
    parentHeartbeat?.stop()

    // Notify and clear task queue
    notifyQueuedTasksAboutDropAndClear('agent shutting down')

    // Cleanup event forwarders before stopping agent
    cleanupAgentEventForwarding()

    // Stop CipherAgent first
    if (cipherAgent) {
      await cipherAgent.stop()
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

    // Start parent heartbeat monitoring after ready
    // This ensures we self-terminate if parent dies (SIGKILL scenario)
    parentHeartbeat = createParentHeartbeat({
      cleanup: stopAgent,
      log: agentLog,
    })
    parentHeartbeat.start()

    // Start credentials polling to detect auth/config changes
    // This ensures CipherAgent stays in sync with user's login state
    startCredentialsPolling()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    agentLog(`Failed to start: ${message}`)
    sendToParent({error: message, type: 'error'})
    // Cleanup before exit to release any acquired resources
    await stopAgent().catch(() => {})
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  // IPC message handler
  process.on('message', async (msg: IPCCommand) => {
    switch (msg.type) {
      case 'health-check': {
        // Fix #3: Health-check after sleep/wake - verify and repair connection
        agentLog('Received health-check from parent - verifying connection')

        // Guard: skip health check during initialization (would interfere with startup sequence)
        if (isInitializing) {
          agentLog('Health-check skipped - initialization in progress')
          sendToParent({success: true, type: 'health-check-result'})
          break
        }

        // Guard: transportClient must exist for health check
        if (!transportClient) {
          agentLog('Health-check failed - transportClient not initialized')
          sendToParent({success: false, type: 'health-check-result'})
          break
        }

        try {
          // Fix #5: Fail-fast - verify socket is responsive before expensive operation
          // After sleep, socket.connected may be true but TCP connection is dead
          const isAlive = await transportClient.isConnected(2000) // 2s timeout
          agentLog(`Health-check: isConnected=${isAlive}, state=${transportClient.getState()}`)

          if (!isAlive) {
            agentLog('Health-check failed - socket not responsive (connection stale)')
            sendToParent({success: false, type: 'health-check-result'})
            break
          }

          // Re-register with Transport to ensure connection is alive
          // Include status in register payload (Transport caches it atomically)
          await transportClient.requestWithAck('agent:register', {status: getAgentStatus()})
          agentLog('Health-check passed - connection verified')
          sendToParent({success: true, type: 'health-check-result'})
        } catch (error) {
          agentLog(`Health-check failed - connection may be stale: ${error}`)
          sendToParent({success: false, type: 'health-check-result'})
          // Socket.IO will attempt reconnection automatically
        }

        break
      }

      case 'ping': {
        sendToParent({type: 'pong'})
        break
      }

      case 'shutdown': {
        await stopAgent()
        sendToParent({type: 'stopped'})
        // eslint-disable-next-line n/no-process-exit
        process.exit(0)
        // Note: break unreachable due to process.exit() above
      }
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
  process.once('disconnect', cleanup)

  // Global exception handlers - ensure cleanup on unexpected errors
  process.on('uncaughtException', async (error) => {
    agentLog(`Uncaught exception: ${error}`)
    await stopAgent().catch(() => {})
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason) => {
    agentLog(`Unhandled rejection: ${reason}`)
    await stopAgent().catch(() => {})
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

// ============================================================================
// Run
// ============================================================================

try {
  await runWorker()
} catch (error) {
  agentLog(`Fatal error: ${error}`)
  // Cleanup before exit to release any acquired resources
  await stopAgent().catch(() => {})
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
