/**
 * Agent Process - Entry point for forked agent child processes.
 *
 * Each agent runs in its own Node.js process (child_process.fork())
 * to isolate from the daemon's event loop and prevent crash propagation.
 *
 * Lifecycle:
 * 1. Read BRV_AGENT_PORT and BRV_AGENT_PROJECT_PATH from process.env
 * 2. Create TransportClient, connect to daemon at 127.0.0.1:port
 * 3. Request initial project config from state server
 * 4. Read provider config and API key from global config (XDG path)
 * 5. Create CipherAgent with lazy providers (resolved from local cache)
 * 6. Start agent + create session
 * 7. Send IPC { type: 'ready', clientId } to parent (AgentPool)
 * 8. Listen for task:execute events → execute via CurateExecutor/QueryExecutor
 * 9. Forward task lifecycle events (started, completed, error) via transport
 * 10. Handle SIGTERM for graceful shutdown
 *
 * Consumed by: AgentPool (forks this file via AgentProcessFactory)
 */

import {connectToTransport, type ITransportClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {TaskExecute} from '../../core/domain/transport/schemas.js'

import {CipherAgent} from '../../../agent/infra/agent/index.js'
import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {NotAuthenticatedError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {TransportTaskEventNames} from '../../core/domain/transport/schemas.js'
import {CurateExecutor} from '../executor/curate-executor.js'
import {QueryExecutor} from '../executor/query-executor.js'
import {createProviderConfigStore} from '../storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../storage/provider-keychain-store.js'
import {AgentInstanceDiscovery} from '../transport/agent-instance-discovery.js'

// ============================================================================
// Environment
// ============================================================================

const portEnv = process.env.BRV_AGENT_PORT
const projectPathEnv = process.env.BRV_AGENT_PROJECT_PATH

if (!portEnv || !projectPathEnv) {
  console.error('agent-process: Missing BRV_AGENT_PORT or BRV_AGENT_PROJECT_PATH')
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}

// After validation, safe to use as strings
const port = portEnv
const projectPath = projectPathEnv

function agentLog(message: string): void {
  console.log(`[agent-process:${projectPath}] ${message}`)
}

// ============================================================================
// Local Config Cache
// ============================================================================

/**
 * Local cache for auth and project config, populated via transport events.
 * Lazy providers on CipherAgent resolve from this cache per HTTP request.
 */
let cachedSessionKey = ''
let cachedAuthValid = false
let cachedBrvConfig: BrvConfig | undefined
let cachedTeamId = ''
let cachedSpaceId = ''

// ============================================================================
// Main
// ============================================================================

let agent: CipherAgent | undefined
let transport: ITransportClient | undefined

async function start(): Promise<void> {
  // 1. Connect to daemon using standard connectToTransport API
  // Note: autoRegister=false because agents use agent:register (not client:register)
  // for special handling (agentClients map, pool notification on disconnect)
  const {client} = await connectToTransport(projectPath, {
    autoRegister: false,
    discovery: new AgentInstanceDiscovery({
      port: Number.parseInt(port, 10),
      projectPath,
    }),
  })
  transport = client
  const clientId = transport.getClientId()
  if (!clientId) {
    throw new Error('Transport connected but no clientId assigned')
  }

  agentLog(`Connected to daemon (clientId=${clientId})`)

  // 2. Request initial project config from state server
  type ProjectConfigResponse = {
    brvConfig?: BrvConfig
    spaceId?: string
    storagePath?: string
    teamId?: string
  }

  type AuthResponse = {
    isValid?: boolean
    sessionKey?: string
  }

  const [configResult, authResult] = await Promise.all([
    transport.requestWithAck<ProjectConfigResponse>('state:getProjectConfig', {projectPath}),
    transport.requestWithAck<AuthResponse>('state:getAuth'),
  ])

  cachedBrvConfig = configResult.brvConfig
  cachedTeamId = configResult.teamId ?? ''
  cachedSpaceId = configResult.spaceId ?? ''
  cachedSessionKey = authResult.sessionKey ?? ''
  cachedAuthValid = authResult.isValid ?? false

  agentLog('Initial config loaded from state server')

  // 3. Listen for config/auth updates from daemon
  transport.on<{brvConfig?: BrvConfig; projectPath: string; spaceId?: string; teamId?: string}>(
    'config:updated',
    (data) => {
      if (data.projectPath !== projectPath) return
      if (data.brvConfig) cachedBrvConfig = data.brvConfig
      if (data.teamId !== undefined) cachedTeamId = data.teamId
      if (data.spaceId !== undefined) cachedSpaceId = data.spaceId
    },
  )

  transport.on<{isValid?: boolean; sessionKey?: string}>('auth:updated', (data) => {
    if (data.sessionKey !== undefined) cachedSessionKey = data.sessionKey
    if (data.isValid !== undefined) cachedAuthValid = data.isValid
  })

  transport.on('auth:expired', () => {
    cachedAuthValid = false
  })

  // 4. Read provider config and API key from global config
  const providerConfigStore = createProviderConfigStore()
  const providerKeychainStore = new ProviderKeychainStore()

  const providerConfig = await providerConfigStore.read()
  const {activeProvider} = providerConfig
  const activeModel = providerConfig.getActiveModel(activeProvider)

  let openRouterApiKey: string | undefined
  if (activeProvider !== 'byterover') {
    openRouterApiKey = await providerKeychainStore.getApiKey(activeProvider)
  }

  agentLog(`Provider: ${activeProvider}, Model: ${activeModel ?? 'default'}`)

  // 5. Create CipherAgent with lazy providers + transport client
  const envConfig = getCurrentConfig()
  const agentConfig = {
    apiBaseUrl: envConfig.llmApiBaseUrl,
    fileSystem: {workingDirectory: projectPath},
    llm: {
      maxIterations: 10,
      maxTokens: 4096,
      temperature: 0.7,
      topK: 10,
      topP: 0.95,
      verbose: false,
    },
    model: activeModel ?? DEFAULT_LLM_MODEL,
    openRouterApiKey,
    projectId: PROJECT,
    storagePath: configResult.storagePath,
  }

  agent = new CipherAgent(agentConfig, cachedBrvConfig, {
    projectIdProvider: () => PROJECT,
    sessionKeyProvider: () => cachedSessionKey,
    spaceIdProvider: () => cachedSpaceId,
    teamIdProvider: () => cachedTeamId,
    transportClient: transport,
  })

  await agent.start()
  await agent.createSession(`daemon-session-${randomUUID()}`)

  agentLog('CipherAgent started and session created')

  // 6. Listen for task:execute from pool
  const curateExecutor = new CurateExecutor()
  const queryExecutor = new QueryExecutor()

  transport.on<TaskExecute>(TransportTaskEventNames.EXECUTE, (task) => {
    // eslint-disable-next-line no-void
    void executeTask(task, curateExecutor, queryExecutor)
  })

  // 7. Register with transport server (for TransportHandlers tracking)
  await transport.requestWithAck('agent:register', {projectPath})

  // 8. Notify parent that we're ready (IPC — AgentPool captures clientId)
  process.send?.({clientId, type: 'ready'})
  agentLog('Ready — listening for tasks')
}

async function executeTask(
  task: TaskExecute,
  curateExecutor: CurateExecutor,
  queryExecutor: QueryExecutor,
): Promise<void> {
  const {clientCwd, clientId, content, files, taskId, type} = task
  if (!transport || !agent) return

  // Refresh config from state server to pick up changes from init/space-switch
  // (they write directly to disk, bypassing the agent's cached state)
  try {
    const configResult = await transport.requestWithAck<{brvConfig?: BrvConfig; spaceId?: string; teamId?: string}>(
      'state:getProjectConfig',
      {projectPath},
    )
    if (configResult.brvConfig) cachedBrvConfig = configResult.brvConfig
    if (configResult.teamId !== undefined) cachedTeamId = configResult.teamId
    if (configResult.spaceId !== undefined) cachedSpaceId = configResult.spaceId
  } catch {
    agentLog('Failed to refresh config before task execution')
  }

  // Refresh auth from state server to pick up login/logout changes
  // (state:getAuth loads fresh from keychain and self-heals via broadcast)
  try {
    const authResult = await transport.requestWithAck<{isValid?: boolean; sessionKey?: string}>('state:getAuth')
    if (authResult.sessionKey !== undefined) cachedSessionKey = authResult.sessionKey
    if (authResult.isValid !== undefined) cachedAuthValid = authResult.isValid
  } catch {
    agentLog('Failed to refresh auth before task execution')
  }

  // Pre-flight auth check — fail fast before file validation or LLM calls.
  // Without this, curate's file validation error would mask the 401.
  if (!cachedAuthValid) {
    const errorData = serializeTaskError(new NotAuthenticatedError())
    transport.request(TransportTaskEventNames.ERROR, {clientId, error: errorData, taskId})
    return
  }

  // Setup per-task event forwarding — forwards llmservice:* events to daemon
  const cleanupForwarding = agent.setupTaskForwarding(taskId)

  // Emit task:started
  transport.request(TransportTaskEventNames.STARTED, {taskId})

  try {
    const result = await (type === 'curate'
      ? curateExecutor.executeWithAgent(agent, {clientCwd, content, files, taskId})
      : queryExecutor.executeWithAgent(agent, {query: content, taskId}))

    // Emit task:completed
    transport.request(TransportTaskEventNames.COMPLETED, {clientId, result, taskId})
  } catch (error) {
    // Emit task:error
    const errorData = serializeTaskError(error)
    transport.request(TransportTaskEventNames.ERROR, {clientId, error: errorData, taskId})
  } finally {
    cleanupForwarding?.()
  }
}

// ============================================================================
// Shutdown
// ============================================================================

async function shutdown(): Promise<void> {
  agentLog('Shutting down...')

  try {
    if (agent) {
      await agent.stop()
      agent = undefined
    }
  } catch {
    // Best-effort
  }

  try {
    if (transport) {
      await transport.disconnect()
      transport = undefined
    }
  } catch {
    // Best-effort
  }

  agentLog('Shutdown complete')
}

// ============================================================================
// Signal Handlers
// ============================================================================

const cleanup = async (): Promise<void> => {
  await shutdown()
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(0)
}

process.once('SIGTERM', cleanup)
process.once('SIGINT', cleanup)
process.once('disconnect', cleanup)

process.on('uncaughtException', async (error) => {
  agentLog(`Uncaught exception: ${error}`)
  await shutdown().catch(() => {})
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  agentLog(`Unhandled rejection: ${reason}`)
  await shutdown().catch(() => {})
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})

// ============================================================================
// Run
// ============================================================================

try {
  await start()
} catch (error) {
  agentLog(`Fatal error during startup: ${error}`)
  await shutdown().catch(() => {})
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
