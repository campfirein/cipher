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

import {SESSIONS_DIR} from '../../../agent/core/domain/session/session-metadata.js'
import {CipherAgent} from '../../../agent/infra/agent/index.js'
import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {FolderPackService} from '../../../agent/infra/folder-pack/folder-pack-service.js'
import {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'
import {AuthEvents} from '../../../shared/transport/events/auth-events.js'
import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {getProviderById} from '../../core/domain/entities/provider-registry.js'
import {NotAuthenticatedError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {
  TransportAgentEventNames,
  TransportStateEventNames,
  TransportTaskEventNames,
} from '../../core/domain/transport/schemas.js'
import {CurateExecutor} from '../executor/curate-executor.js'
import {FolderPackExecutor} from '../executor/folder-pack-executor.js'
import {QueryExecutor} from '../executor/query-executor.js'
import {getProviderApiKeyFromEnv} from '../provider/env-provider-detector.js'
import {createProviderConfigStore} from '../storage/file-provider-config-store.js'
import {createProviderKeychainStore} from '../storage/provider-keychain-store.js'
import {AgentInstanceDiscovery} from '../transport/agent-instance-discovery.js'
import {resolveSessionId} from './session-resolver.js'

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
// Provider Config
// ============================================================================

interface ProviderConfiguration {
  openRouterApiKey?: string
  provider?: string
  providerApiKey?: string
  providerBaseUrl?: string
  providerHeaders?: Record<string, string>
  providerLocation?: string
  providerProject?: string
}

/**
 * Load provider-specific configuration: API key, base URL, headers, etc.
 * Mirrors the routing logic from the old agent-worker loadProviderConfiguration().
 */
async function loadProviderConfiguration(
  activeProvider: string,
  providerConfig: Awaited<ReturnType<ReturnType<typeof createProviderConfigStore>['read']>>,
): Promise<ProviderConfiguration> {
  const result: ProviderConfiguration = {}

  if (activeProvider === 'byterover') {
    return result
  }

  // Get API key: keychain first, then environment variable
  const providerKeychainStore = createProviderKeychainStore()
  let apiKey = await providerKeychainStore.getApiKey(activeProvider)
  if (!apiKey) {
    apiKey = getProviderApiKeyFromEnv(activeProvider)
  }

  switch (activeProvider) {
    case 'google-vertex': {
      result.provider = activeProvider
      result.providerProject = process.env.GOOGLE_CLOUD_PROJECT || undefined
      result.providerLocation = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'

      break
    }

    case 'openai-compatible': {
      result.provider = activeProvider
      result.providerApiKey = apiKey || undefined
      result.providerBaseUrl = providerConfig.getBaseUrl(activeProvider) || undefined

      break
    }

    case 'openrouter': {
      result.openRouterApiKey = apiKey

      break
    }

    default: {
      // Direct provider (anthropic, openai, google, xai, groq, mistral, etc.)
      const providerDef = getProviderById(activeProvider)
      result.provider = activeProvider
      result.providerApiKey = apiKey
      result.providerBaseUrl = providerDef?.baseUrl || undefined
      const headers = providerDef?.headers
      result.providerHeaders = headers && Object.keys(headers).length > 0 ? {...headers} : undefined

      break
    }
  }

  return result
}

// ============================================================================
// Main
// ============================================================================

let agent: CipherAgent | undefined
let metadataStore: SessionMetadataStore
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
    storagePath: string
    teamId?: string
  }

  type AuthResponse = {
    isValid?: boolean
    sessionKey?: string
  }

  const [configResult, authResult] = await Promise.all([
    transport.requestWithAck<ProjectConfigResponse>(TransportStateEventNames.GET_PROJECT_CONFIG, {projectPath}),
    transport.requestWithAck<AuthResponse>(TransportStateEventNames.GET_AUTH),
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

  transport.on<{isValid?: boolean; sessionKey?: string}>(AuthEvents.UPDATED, (data) => {
    if (data.sessionKey !== undefined) cachedSessionKey = data.sessionKey
    if (data.isValid !== undefined) cachedAuthValid = data.isValid
  })

  transport.on(AuthEvents.EXPIRED, () => {
    cachedAuthValid = false
  })

  // 4. Read provider config and API key from global config
  const providerConfigStore = createProviderConfigStore()
  const providerConfig = await providerConfigStore.read()
  const {activeProvider} = providerConfig
  const activeModel = providerConfig.getActiveModel(activeProvider)
  const providerConfiguration = await loadProviderConfiguration(activeProvider, providerConfig)

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
    projectId: PROJECT,
    storagePath: configResult.storagePath,
    ...providerConfiguration,
  }

  agent = new CipherAgent(agentConfig, cachedBrvConfig, {
    projectIdProvider: () => PROJECT,
    sessionKeyProvider: () => cachedSessionKey,
    spaceIdProvider: () => cachedSpaceId,
    teamIdProvider: () => cachedTeamId,
    transportClient: transport,
  })

  await agent.start()

  // 5b. Resolve session: resume last active or create new
  const sessionsDir = `${configResult.storagePath}/${SESSIONS_DIR}`
  metadataStore = new SessionMetadataStore({sessionsDir, workingDirectory: projectPath})

  const newId = `agent-session-${randomUUID()}`
  const {isResume, sessionId} = await resolveSessionId(metadataStore, newId, agentLog)

  await agent.createSession(sessionId)
  agent.switchDefaultSession(sessionId)

  // Persist session metadata (best-effort)
  try {
    const metadata = metadataStore.createSessionMetadata(sessionId)
    if (isResume) metadata.status = 'active'
    await metadataStore.saveSession(metadata)
    await metadataStore.setActiveSession(sessionId)
  } catch (error) {
    agentLog(`Session metadata persist failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  agentLog(`CipherAgent started (session=${sessionId}, resume=${isResume})`)

  // 6. Handle agent:newSession from /new command (via ConnectionCoordinator)
  const transportRef = transport
  transport.on<{reason?: string}>(TransportAgentEventNames.NEW_SESSION, async (data) => {
    agentLog(`New session requested: ${data.reason ?? 'no reason'}`)

    if (!agent) {
      await transportRef.requestWithAck(TransportAgentEventNames.NEW_SESSION_CREATED, {
        error: 'Agent not initialized',
        success: false,
      })
      return
    }

    try {
      // Mark current session as ended (best-effort)
      if (agent.sessionId) {
        try {
          const current = await metadataStore.getSession(agent.sessionId)
          if (current) {
            current.status = 'ended'
            current.lastUpdated = new Date().toISOString()
            await metadataStore.saveSession(current)
          }
        } catch {
          /* best-effort */
        }
      }

      const newSessionId = `agent-session-${randomUUID()}`
      await agent.createSession(newSessionId)
      agent.switchDefaultSession(newSessionId)

      // Persist new session metadata (best-effort)
      try {
        await metadataStore.saveSession(metadataStore.createSessionMetadata(newSessionId))
        await metadataStore.setActiveSession(newSessionId)
      } catch {
        /* best-effort */
      }

      agentLog(`New session created: ${newSessionId}`)

      await transportRef.requestWithAck(TransportAgentEventNames.NEW_SESSION_CREATED, {
        sessionId: newSessionId,
        success: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      agentLog(`New session creation error: ${message}`)
      await transportRef.requestWithAck(TransportAgentEventNames.NEW_SESSION_CREATED, {
        error: message,
        success: false,
      })
    }
  })

  // 7. Listen for task:execute from pool
  // 6. Create FileSystemService + SearchKnowledgeService for smart query routing
  const fileSystemService = new FileSystemService({workingDirectory: projectPath})
  await fileSystemService.initialize()
  const searchService = createSearchKnowledgeService(fileSystemService, {baseDirectory: projectPath})

  // 7. Create executors and listen for task:execute from pool
  const curateExecutor = new CurateExecutor()
  const folderPackService = new FolderPackService(fileSystemService)
  await folderPackService.initialize()
  const folderPackExecutor = new FolderPackExecutor(folderPackService)
  const queryExecutor = new QueryExecutor({
    enableCache: true,
    fileSystem: fileSystemService,
    searchService,
  })

  transport.on<TaskExecute>(TransportTaskEventNames.EXECUTE, (task) => {
    // eslint-disable-next-line no-void
    void executeTask(task, curateExecutor, folderPackExecutor, queryExecutor)
  })

  // 8. Register with transport server (for TransportHandlers tracking)
  await transport.requestWithAck('agent:register', {projectPath})

  // 9. Notify parent that we're ready (IPC — AgentPool captures clientId)
  process.send?.({clientId, type: 'ready'})
  agentLog('Ready — listening for tasks')
}

async function executeTask(
  task: TaskExecute,
  curateExecutor: CurateExecutor,
  folderPackExecutor: FolderPackExecutor,
  queryExecutor: QueryExecutor,
): Promise<void> {
  const {clientCwd, clientId, content, files, folderPath, taskId, type} = task
  if (!transport || !agent) return

  // Refresh config from state server to pick up changes from init/space-switch
  // (they write directly to disk, bypassing the agent's cached state)
  try {
    const configResult = await transport.requestWithAck<{brvConfig?: BrvConfig; spaceId?: string; teamId?: string}>(
      TransportStateEventNames.GET_PROJECT_CONFIG,
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
    const authResult = await transport.requestWithAck<{isValid?: boolean; sessionKey?: string}>(
      TransportStateEventNames.GET_AUTH,
    )
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
    let result: string
    switch (type) {
      case 'curate': {
        result = await curateExecutor.executeWithAgent(agent, {clientCwd, content, files, taskId})

        break
      }

      case 'curate-folder': {
        result = await folderPackExecutor.executeWithAgent(agent, {
          clientCwd,
          content,
          folderPath: folderPath!,
          taskId,
        })

        break
      }

      case 'query': {
        result = await queryExecutor.executeWithAgent(agent, {query: content, taskId})

        break
      }
    }

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
