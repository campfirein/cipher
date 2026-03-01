/**
 * Agent Process - Entry point for forked agent child processes.
 *
 * Each agent runs in its own Node.js process (child_process.fork())
 * to isolate from the daemon's event loop and prevent crash propagation.
 *
 * Lifecycle:
 * 1. Read BRV_AGENT_PORT and BRV_AGENT_PROJECT_PATH from process.env
 * 2. Create TransportClient, connect to daemon at 127.0.0.1:port
 * 3. Request initial project config + provider config from state server
 * 4. Listen for provider:updated events (hot-switch without restart)
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
import {appendFileSync} from 'node:fs'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ProviderConfigResponse, TaskExecute} from '../../core/domain/transport/schemas.js'

import {SESSIONS_DIR} from '../../../agent/core/domain/session/session-metadata.js'
import {CipherAgent} from '../../../agent/infra/agent/index.js'
import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {FolderPackService} from '../../../agent/infra/folder-pack/folder-pack-service.js'
import {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'
import {AuthEvents} from '../../../shared/transport/events/auth-events.js'
import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {serializeTaskError, TaskError, TaskErrorCode} from '../../core/domain/errors/task-error.js'
import {
  TransportAgentEventNames,
  TransportDaemonEventNames,
  TransportStateEventNames,
  TransportTaskEventNames,
} from '../../core/domain/transport/schemas.js'
import {CurateExecutor} from '../executor/curate-executor.js'
import {FolderPackExecutor} from '../executor/folder-pack-executor.js'
import {QueryExecutor} from '../executor/query-executor.js'
import {AgentInstanceDiscovery} from '../transport/agent-instance-discovery.js'
import {createAgentLogger} from './agent-logger.js'
import {resolveSessionId} from './session-resolver.js'

// ============================================================================
// Environment
// ============================================================================

const portEnv = process.env.BRV_AGENT_PORT
const projectPathEnv = process.env.BRV_AGENT_PROJECT_PATH

if (!portEnv || !projectPathEnv) {
  // Always print to stderr so AgentPool / developers can diagnose boot failures
  // even when BRV_SESSION_LOG is not configured.
  console.error('agent-process: Missing BRV_AGENT_PORT or BRV_AGENT_PROJECT_PATH')

  const logPath = process.env.BRV_SESSION_LOG
  if (logPath) {
    appendFileSync(
      logPath,
      `${new Date().toISOString()} [agent-process] Missing BRV_AGENT_PORT or BRV_AGENT_PROJECT_PATH\n`,
    )
  }

  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}

// After validation (unreachable if env vars are missing), safe to use as strings
const port = portEnv
const projectPath = projectPathEnv

const agentLog = createAgentLogger(process.env.BRV_SESSION_LOG, `[agent-process:${projectPath}]`)

/**
 * Persist a brand-new session's metadata and set it as active.
 * Best-effort — failures are logged but never block the caller.
 */
async function persistNewSession(sessionId: string, providerId: string): Promise<void> {
  try {
    const metadata = metadataStore.createSessionMetadata(sessionId, providerId)
    await metadataStore.saveSession(metadata)
    await metadataStore.setActiveSession(sessionId)
  } catch (error) {
    agentLog(`Session metadata persist failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Activate an existing session: load its metadata, update status + providerId, and set as active.
 * Preserves original createdAt, messageCount, summary, and other fields.
 * Best-effort — failures are logged but never block the caller.
 */
async function activateExistingSession(sessionId: string, providerId: string): Promise<void> {
  try {
    const existing = await metadataStore.getSession(sessionId)
    if (existing) {
      existing.status = 'active'
      existing.lastUpdated = new Date().toISOString()
      if (providerId) existing.providerId = providerId
      await metadataStore.saveSession(existing)
    } else {
      // Metadata file missing — fall back to creating new metadata
      const metadata = metadataStore.createSessionMetadata(sessionId, providerId)
      await metadataStore.saveSession(metadata)
    }

    await metadataStore.setActiveSession(sessionId)
  } catch (error) {
    agentLog(`Session metadata activate failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================================================
// Local Config Cache
// ============================================================================

/**
 * Local cache for auth and project config, populated via transport events.
 * Lazy providers on CipherAgent resolve from this cache per HTTP request.
 */
let cachedSessionKey = ''
let cachedBrvConfig: BrvConfig | undefined
let cachedTeamId = ''
let cachedSpaceId = ''
let cachedActiveProvider = ''
let cachedActiveModel = ''

// ============================================================================
// Provider Config (resolved by daemon via state:getProviderConfig)
// ============================================================================

let providerConfigDirty = false
let providerFetchRetries = 0
const MAX_PROVIDER_FETCH_RETRIES = 3

// Concurrent task tracking — guards config refresh and provider hot-swap
let activeTaskCount = 0

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

  // Log socket disconnect — critical for diagnosing ping-timeout crashes
  transport.on('disconnect', (reason?: string) => {
    agentLog(`Transport socket DISCONNECTED reason=${reason ?? 'unknown'} activeTaskCount=${activeTaskCount}`)
  })
  transport.on('connect_error', (err?: Error) => {
    agentLog(`Transport connect_error: ${err?.message ?? 'unknown'}`)
  })

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

  const [configResult, authResult, providerResult] = await Promise.all([
    transport.requestWithAck<ProjectConfigResponse>(TransportStateEventNames.GET_PROJECT_CONFIG, {projectPath}),
    transport.requestWithAck<AuthResponse>(TransportStateEventNames.GET_AUTH),
    transport.requestWithAck<ProviderConfigResponse>(TransportStateEventNames.GET_PROVIDER_CONFIG),
  ])

  cachedBrvConfig = configResult.brvConfig
  cachedTeamId = configResult.teamId ?? ''
  cachedSpaceId = configResult.spaceId ?? ''
  cachedSessionKey = authResult.sessionKey ?? ''

  agentLog('Initial config loaded from state server')

  // 3. Listen for config/auth/provider updates from daemon
  transport.on<{brvConfig?: BrvConfig; projectPath: string; spaceId?: string; teamId?: string}>(
    'config:updated',
    (data) => {
      if (data.projectPath !== projectPath) return
      if (data.brvConfig) cachedBrvConfig = data.brvConfig
      if (data.teamId !== undefined) cachedTeamId = data.teamId
      if (data.spaceId !== undefined) cachedSpaceId = data.spaceId
    },
  )

  transport.on<{sessionKey?: string}>(AuthEvents.UPDATED, (data) => {
    if (data.sessionKey !== undefined) cachedSessionKey = data.sessionKey
  })

  transport.on(TransportDaemonEventNames.PROVIDER_UPDATED, () => {
    providerConfigDirty = true
    providerFetchRetries = 0
  })

  // 4. Provider config resolved by daemon (API key, base URL, headers, etc.)
  const {activeModel, activeProvider} = providerResult
  cachedActiveProvider = activeProvider
  cachedActiveModel = activeModel ?? DEFAULT_LLM_MODEL

  agentLog(`Provider: ${activeProvider}, Model: ${activeModel ?? 'default'}`)

  // 5. Create CipherAgent with lazy providers + transport client
  // Set GOOGLE_APPLICATION_CREDENTIALS for Vertex AI before creating agent
  if (providerResult.providerCredentialPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = providerResult.providerCredentialPath
  }

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
    maxInputTokens: providerResult.maxInputTokens,
    model: activeModel ?? DEFAULT_LLM_MODEL,
    openRouterApiKey: providerResult.openRouterApiKey,
    projectId: PROJECT,
    provider: providerResult.provider,
    providerApiKey: providerResult.providerApiKey,
    providerBaseUrl: providerResult.providerBaseUrl,
    providerHeaders: providerResult.providerHeaders,
    providerLocation: providerResult.providerLocation,
    providerProject: providerResult.providerProject,
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

  // 5b. Resolve session: resume last active or create new
  const sessionsDir = `${configResult.storagePath}/${SESSIONS_DIR}`
  metadataStore = new SessionMetadataStore({sessionsDir, workingDirectory: projectPath})

  const newId = `agent-session-${randomUUID()}`
  const {isResume, sessionId} = await resolveSessionId({
    currentProviderId: activeProvider,
    log: agentLog,
    metadataStore,
    newSessionId: newId,
  })

  await agent.createSession(sessionId)
  agent.switchDefaultSession(sessionId)

  await (isResume ? activateExistingSession(sessionId, activeProvider) : persistNewSession(sessionId, activeProvider))

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

      await persistNewSession(newSessionId, cachedActiveProvider)

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
    baseDirectory: projectPath,
    enableCache: true,
    fileSystem: fileSystemService,
    searchService,
  })

  transport.on<TaskExecute>(TransportTaskEventNames.EXECUTE, (task) => {
    agentLog(`task:execute received taskId=${task.taskId} type=${task.type} activeTaskCount=${activeTaskCount + 1}`)
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

  const freshProviderConfig = await transport.requestWithAck<ProviderConfigResponse>(
    TransportStateEventNames.GET_PROVIDER_CONFIG,
  )
  if (!freshProviderConfig.activeProvider) {
    const error = serializeTaskError(
      new TaskError(
        'No provider connected. Use /provider in the REPL to configure a provider.',
        TaskErrorCode.PROVIDER_NOT_CONFIGURED,
      ),
    )
    transport.request(TransportTaskEventNames.ERROR, {clientId, error, taskId})
    return
  }

  if (freshProviderConfig.providerKeyMissing) {
    const modelInfo = freshProviderConfig.activeModel ? ` (model: ${freshProviderConfig.activeModel})` : ''
    const errorMessage = freshProviderConfig.providerCredentialError
      ?? `${freshProviderConfig.activeProvider} API key is missing${modelInfo}. Use /provider in the REPL to reconnect.`
    const error = serializeTaskError(
      new TaskError(errorMessage, TaskErrorCode.PROVIDER_NOT_CONFIGURED),
    )
    transport.request(TransportTaskEventNames.ERROR, {clientId, error, taskId})
    return
  }

  activeTaskCount++

  try {
    // Only refresh config and hot-swap provider when this is the first concurrent task.
    // Subsequent concurrent tasks reuse cached config to avoid race conditions
    // on provider hot-swap (which replaces SessionManager).
    if (activeTaskCount === 1) {
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

      // Refresh provider config if changed (provider:updated event sets dirty flag)
      if (providerConfigDirty && agent) {
        const result = await hotSwapProvider(agent, transport)
        if (result.error) {
          try {
            transport.request(TransportTaskEventNames.ERROR, {clientId, error: result.error, taskId})
          } catch (error) {
            agentLog(
              `task:error send failed (hotSwap) taskId=${taskId}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }

          return
        }
      }
    }

    // Auth refresh always runs — auth can expire between any two tasks
    try {
      const authResult = await transport.requestWithAck<{isValid?: boolean; sessionKey?: string}>(
        TransportStateEventNames.GET_AUTH,
      )
      if (authResult.sessionKey !== undefined) cachedSessionKey = authResult.sessionKey
    } catch {
      agentLog('Failed to refresh auth before task execution')
    }

    // Setup per-task event forwarding — forwards llmservice:* events to daemon
    const cleanupForwarding = agent.setupTaskForwarding(taskId)

    // Emit task:started
    agentLog(`task:started taskId=${taskId} type=${type}`)
    try {
      transport.request(TransportTaskEventNames.STARTED, {taskId})
    } catch (error) {
      agentLog(`task:started send failed taskId=${taskId}: ${error instanceof Error ? error.message : String(error)}`)
      // Socket dropped — continue executing so we can still emit task:completed/error when socket reconnects
    }

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
      agentLog(`task:completed taskId=${taskId}`)
      try {
        transport.request(TransportTaskEventNames.COMPLETED, {clientId, result, taskId})
      } catch (error) {
        agentLog(
          `task:completed send failed taskId=${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } catch (error) {
      // Emit task:error
      const errorData = serializeTaskError(error)
      agentLog(`task:error taskId=${taskId} error=${errorData.message}`)
      try {
        transport.request(TransportTaskEventNames.ERROR, {clientId, error: errorData, taskId})
      } catch (error_) {
        agentLog(
          `task:error send failed taskId=${taskId}: ${error_ instanceof Error ? error_.message : String(error_)}`,
        )
      }
    } finally {
      cleanupForwarding?.()
    }
  } finally {
    activeTaskCount--

    // Deferred hot-swap: if provider changed while tasks were in-flight,
    // trigger swap now that all tasks are done
    if (activeTaskCount === 0 && providerConfigDirty && agent && transport) {
      hotSwapProvider(agent, transport).catch((error) => {
        agentLog(`deferred hotSwapProvider failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }
}

// ============================================================================
// Provider Hot-Swap
// ============================================================================

/**
 * Hot-swap provider: fetch new config, replace SessionManager, create session.
 * Returns error payload if swap fails fatally (caller must abort task).
 *
 * If only the model changed (same provider), the session ID is reused on the
 * fresh SessionManager for metadata continuity (in-memory history is not preserved).
 * If the provider changed, a new session is created (history format is incompatible).
 */
async function hotSwapProvider(
  currentAgent: CipherAgent,
  transportClient: NonNullable<typeof transport>,
): Promise<{error?: ReturnType<typeof serializeTaskError>}> {
  // Phase 1: Fetch config (safe to fail — old provider still intact)
  let freshProvider: ProviderConfigResponse | undefined
  try {
    freshProvider = await transportClient.requestWithAck<ProviderConfigResponse>(
      TransportStateEventNames.GET_PROVIDER_CONFIG,
    )
  } catch (error) {
    agentLog(`Failed to fetch provider config: ${error instanceof Error ? error.message : String(error)}`)
    providerFetchRetries++
    if (providerFetchRetries >= MAX_PROVIDER_FETCH_RETRIES) {
      agentLog(`Provider config fetch failed ${providerFetchRetries} times, giving up`)
      providerConfigDirty = false
      providerFetchRetries = 0
    }

    // Leave providerConfigDirty=true so the next task retries
    return {}
  }

  if (!freshProvider) {
    providerConfigDirty = false
    providerFetchRetries = 0
    return {}
  }

  providerFetchRetries = 0
  const ap = freshProvider.activeProvider
  const newModel = freshProvider.activeModel ?? DEFAULT_LLM_MODEL
  const isProviderChange = ap !== cachedActiveProvider
  const isModelChange = newModel !== cachedActiveModel

  // Nothing actually changed (duplicate event) — skip
  if (!isProviderChange && !isModelChange) {
    providerConfigDirty = false
    return {}
  }

  // Phase 2a: Replace SessionManager (if this throws, old SM remains intact)
  // Update GOOGLE_APPLICATION_CREDENTIALS for Vertex AI hot-swap
  if (freshProvider.providerCredentialPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = freshProvider.providerCredentialPath
  }

  const previousSessionId = currentAgent.sessionId
  try {
    // Map fields explicitly to prevent accidental field leakage from ProviderConfigResponse
    currentAgent.refreshProviderConfig({
      maxInputTokens: freshProvider.maxInputTokens,
      model: newModel,
      openRouterApiKey: freshProvider.openRouterApiKey,
      provider: freshProvider.provider,
      providerApiKey: freshProvider.providerApiKey,
      providerBaseUrl: freshProvider.providerBaseUrl,
      providerHeaders: freshProvider.providerHeaders,
      providerLocation: freshProvider.providerLocation,
      providerProject: freshProvider.providerProject,
    })
  } catch (error) {
    // Old SM still intact — no recovery needed.
    // Clear dirty flag to prevent repeated failures with the same broken config.
    // A new provider:updated event (from any UI action) will re-trigger the swap.
    providerConfigDirty = false
    return {
      error: serializeTaskError(
        new TaskError(
          `Provider switch failed (SessionManager rebuild): ${error instanceof Error ? error.message : String(error)}`,
          TaskErrorCode.TASK_EXECUTION,
        ),
      ),
    }
  }

  // Phase 2b: Create session on the new SM (old SM is disposed at this point)
  try {
    if (isProviderChange || !previousSessionId) {
      // Provider changed: new session (history format incompatible across providers)
      const newSessionId = `agent-session-${randomUUID()}`
      await currentAgent.createSession(newSessionId)
      currentAgent.switchDefaultSession(newSessionId)
      await persistNewSession(newSessionId, ap)
    } else {
      // Model-only change: reuse session ID for metadata continuity.
      // Note: in-memory conversation history is lost (new SessionManager has no sessions).
      // Only the session ID and persisted metadata are preserved.
      await currentAgent.createSession(previousSessionId)
      currentAgent.switchDefaultSession(previousSessionId)
      await activateExistingSession(previousSessionId, ap)
    }
  } catch (sessionError) {
    // SM was swapped but preferred session failed — attempt recovery with a fresh session
    agentLog(
      `Session creation failed after SM swap: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`,
    )
    try {
      const recoveryId = `agent-session-${randomUUID()}`
      await currentAgent.createSession(recoveryId)
      currentAgent.switchDefaultSession(recoveryId)
      await persistNewSession(recoveryId, ap)
      agentLog(`Recovery session created: ${recoveryId}`)
    } catch (error) {
      providerConfigDirty = false
      return {
        error: serializeTaskError(
          new TaskError(
            `Provider switch failed (session recovery): ${error instanceof Error ? error.message : String(error)}`,
            TaskErrorCode.TASK_EXECUTION,
          ),
        ),
      }
    }
  }

  providerConfigDirty = false
  cachedActiveProvider = ap
  cachedActiveModel = newModel

  agentLog(`Provider hot-switched: ${ap}, Model: ${newModel}`)
  return {}
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
  // appendFileSync is synchronous — guaranteed to write before process.exit(1)
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error)
  agentLog(`CRASH uncaughtException: ${stack}`)
  await shutdown().catch(() => {})
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  const stack = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  agentLog(`CRASH unhandledRejection: ${stack}`)
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
