/**
 * Daemon entry point — standalone Node.js process.
 *
 * This file is spawned as a detached child process by any client
 * (TUI, MCP, CLI) via `brv-transport-client`. It does NOT depend
 * on oclif or any CLI framework.
 *
 * Hosts the Socket.IO transport server directly. All clients (TUI, CLI,
 * MCP, agent child processes) connect to this single server.
 *
 * Startup sequence:
 * 1. Setup daemon logging
 * 2. Select port (random batch scan in dynamic range 49152-65535)
 * 3. Acquire global instance lock (atomic temp+rename)
 * 4. Start Socket.IO transport server
 * 5. Start heartbeat writer
 * 6. Install daemon resilience handlers
 * 7. Create services (auth, project state, agent pool, handlers)
 * 8. Wire events (idle timeout, auth broadcasts, state server)
 * 9. Create shutdown handler
 * 10. Start idle timer + register signal handlers
 */

import {GlobalInstanceManager} from '@campfirein/brv-transport-client'
import {fork} from 'node:child_process'
import {mkdirSync, readdirSync, readFileSync, unlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'

import {
  AGENT_IDLE_CHECK_INTERVAL_MS,
  AGENT_IDLE_TIMEOUT_MS,
  AGENT_POOL_MAX_SIZE,
  HEARTBEAT_FILE,
} from '../../constants.js'
import {type ProviderConfigResponse, TransportStateEventNames} from '../../core/domain/transport/schemas.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {crashLog, processLog} from '../../utils/process-logger.js'
import {ClientManager} from '../client/client-manager.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {broadcastToProjectRoom} from '../process/broadcast-utils.js'
import {CurateLogHandler} from '../process/curate-log-handler.js'
import {setupFeatureHandlers} from '../process/feature-handlers.js'
import {TransportHandlers} from '../process/transport-handlers.js'
import {ProjectRegistry} from '../project/project-registry.js'
import {clearStaleProviderConfig, resolveProviderConfig} from '../provider/provider-config-resolver.js'
import {ProjectRouter} from '../routing/project-router.js'
import {AuthStateStore} from '../state/auth-state-store.js'
import {ProjectStateLoader} from '../state/project-state-loader.js'
import {FileProviderConfigStore} from '../storage/file-provider-config-store.js'
import {createProviderKeychainStore} from '../storage/provider-keychain-store.js'
import {createTokenStore} from '../storage/token-store.js'
import {SocketIOTransportServer} from '../transport/socket-io-transport-server.js'
import {AgentIdleTimeoutPolicy} from './agent-idle-timeout-policy.js'
import {AgentPool} from './agent-pool.js'
import {DaemonResilience} from './daemon-resilience.js'
import {HeartbeatWriter} from './heartbeat.js'
import {IdleTimeoutPolicy} from './idle-timeout-policy.js'
import {selectDaemonPort} from './port-selector.js'
import {ShutdownHandler} from './shutdown-handler.js'

function log(msg: string): void {
  processLog(`[Daemon] ${msg}`)
}

/**
 * Reads the CLI version from package.json.
 * Walks up from the compiled file location to find the project root.
 */
function readCliVersion(): string {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    // Both src/ and dist/ are 4 levels deep: server/infra/daemon/brv-server
    const pkgPath = join(currentDir, '..', '..', '..', '..', 'package.json')
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string') {
      return pkg.version
    }
  } catch {
    // Best-effort — return fallback
  }

  return 'unknown'
}

/**
 * Removes old daemon log files, keeping the most recent ones.
 * Filenames are timestamp-based (`server-YYYY-MM-DDTHH-MM-SS.log`),
 * so alphabetical sort = chronological order.
 */
function cleanupOldLogs(logsDir: string, keep: number): void {
  try {
    const files = readdirSync(logsDir)
      .filter((f) => f.startsWith('server-') && f.endsWith('.log'))
      .sort()

    if (files.length <= keep) return

    const toDelete = files.slice(0, files.length - keep)
    for (const file of toDelete) {
      try {
        unlinkSync(join(logsDir, file))
      } catch {
        // Best-effort per file
      }
    }
  } catch {
    // Best-effort — don't block daemon startup
  }
}

async function main(): Promise<void> {
  // 1. Setup daemon logging at <global-data-dir>/logs/server-<timestamp>.log
  const daemonLogsDir = join(getGlobalDataDir(), 'logs')
  mkdirSync(daemonLogsDir, {recursive: true})
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  process.env.BRV_SESSION_LOG = join(daemonLogsDir, `server-${timestamp}.log`)

  // Best-effort cleanup of old daemon log files (keep last 10)
  cleanupOldLogs(daemonLogsDir, 10)

  log('Starting daemon...')

  // 2. Select port (random batch scan in dynamic range 49152-65535)
  const portResult = await selectDaemonPort()
  if (!portResult.success) {
    log('Failed to find available port for daemon (dynamic port range 49152-65535 exhausted)')
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  const {port} = portResult
  log(`Selected port ${port}`)

  // 3. Acquire global instance lock (atomic temp+rename)
  const version = readCliVersion()
  const instanceManager = new GlobalInstanceManager()
  const acquireResult = instanceManager.acquire(port, version)
  if (!acquireResult.acquired) {
    if (acquireResult.reason === 'already_running') {
      log(
        `Another daemon already running (PID: ${acquireResult.existingInstance.pid}, port: ${acquireResult.existingInstance.port})`,
      )
    } else {
      log(`Failed to acquire instance lock: ${acquireResult.reason}`)
    }

    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  log(`Instance acquired (PID: ${process.pid}, port: ${port})`)
  const daemonStartedAt = Date.now()

  // Steps 4-10 are wrapped so that partial startup is cleaned up.
  // Without this, a partial startup leaves daemon.json pointing to
  // a dead PID and may leak the port until stale-detection kicks in.
  //
  // Hoisted so the catch block can stop whatever was started.
  let transportServer: SocketIOTransportServer | undefined
  let heartbeatWriter: HeartbeatWriter | undefined
  let authStateStore: AuthStateStore | undefined
  let agentPool: AgentPool | undefined

  try {
    // 4. Start Socket.IO transport server
    transportServer = new SocketIOTransportServer()
    await transportServer.start(port)
    log(`Transport server started on port ${port}`)

    // 5. Start heartbeat writer
    const heartbeatPath = join(getGlobalDataDir(), HEARTBEAT_FILE)
    heartbeatWriter = new HeartbeatWriter({
      filePath: heartbeatPath,
      log,
    })
    heartbeatWriter.start()

    // 6. Install daemon resilience (crash/signal/sleep handlers)
    const daemonResilience = new DaemonResilience({
      crashLog,
      log,
      onWake() {
        log('Wake from sleep detected — refreshing heartbeat')
        heartbeatWriter?.refresh()
      },
    })
    daemonResilience.install()

    // 7. Create services (auth, project state, agent pool, handlers)
    const projectRegistry = new ProjectRegistry({log})
    const projectRouter = new ProjectRouter({transport: transportServer})
    const clientManager = new ClientManager()

    authStateStore = new AuthStateStore({log, tokenStore: createTokenStore()})
    const projectStateLoader = new ProjectStateLoader({
      configStore: new ProjectConfigStore(),
      log,
      projectRegistry,
    })

    // Agent idle timeout policy — kills agents after period of inactivity
    const agentIdleTimeoutPolicy = new AgentIdleTimeoutPolicy({
      checkIntervalMs: AGENT_IDLE_CHECK_INTERVAL_MS,
      getQueueLength: (projectPath: string) =>
        agentPool?.getQueueState().find((q) => q.projectPath === projectPath)?.queueLength ?? 0,
      log,
      onAgentIdle(projectPath: string, queueLength: number) {
        // Don't kill agents that have queued tasks waiting
        if (queueLength > 0) {
          log(`Skipping idle cleanup: ${projectPath} has ${queueLength} queued tasks`)
          return
        }

        // Don't kill agents that are actively processing a task
        const entry = agentPool?.getEntries().find((e) => e.projectPath === projectPath)
        if (entry?.hasActiveTask) {
          log(`Skipping idle cleanup: ${projectPath} has active task`)
          return
        }

        log(`Killing idle agent: ${projectPath}`)
        agentPool?.handleAgentDisconnected(projectPath)
      },
      timeoutMs: AGENT_IDLE_TIMEOUT_MS,
    })

    // Agent pool with fork-based factory — each agent runs in its own process
    const currentDir = dirname(fileURLToPath(import.meta.url))
    const agentProcessPath = process.env.BRV_AGENT_PROCESS_PATH ?? join(currentDir, 'agent-process.js')

    agentPool = new AgentPool({
      agentIdleTimeoutPolicy,
      agentProcessFactory(projectPath) {
        return fork(agentProcessPath, [], {
          cwd: projectPath,
          env: {
            ...process.env,
            BRV_AGENT_PORT: String(port),
            BRV_AGENT_PROJECT_PATH: projectPath,
          },
          // In E2E mode, inherit stderr to see agent errors
          stdio: process.env.BRV_E2E_MODE === 'true' ? ['ignore', 'inherit', 'inherit', 'ipc'] : undefined,
        })
      },
      log,
      transportServer,
    })

    // Start agent idle timeout policy
    agentIdleTimeoutPolicy.start()

    const curateLogHandler = new CurateLogHandler()

    const transportHandlers = new TransportHandlers({
      agentPool,
      clientManager,
      lifecycleHooks: [curateLogHandler],
      projectRegistry,
      projectRouter,
      transport: transportServer,
    })
    transportHandlers.setup()

    // 8. Create idle timeout policy + shutdown handler
    //    (must be created before wiring closures that reference them)

    // onIdle captures shutdownHandler via closure; safe because
    // the callback only fires after start() + timeout, by which
    // point shutdownHandler is fully assigned below.
    // eslint-disable-next-line prefer-const
    let shutdownHandler: ShutdownHandler

    const idleTimeoutPolicy = new IdleTimeoutPolicy({
      log,
      onIdle() {
        log('Idle timeout reached — initiating shutdown')
        shutdownHandler.shutdown().catch((error: unknown) => {
          log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
    })

    // 9. Create shutdown handler (agent pool shut down before transport)
    shutdownHandler = new ShutdownHandler({
      agentIdleTimeoutPolicy,
      agentPool,
      daemonResilience,
      heartbeatWriter,
      idleTimeoutPolicy,
      instanceManager,
      log,
      transportServer,
    })

    // 10. Wire events (state server, idle timeout)
    // Note: auth change broadcasting (onAuthChanged/onAuthExpired) is handled by AuthHandler
    // in setupFeatureHandlers(). loadToken() + startPolling() are called after feature handlers
    // are registered so AuthHandler's callbacks are in place.

    // Wire project empty → mark agent idle for cleanup
    clientManager.onProjectEmpty((projectPath) => {
      agentPool!.markIdle(projectPath)
    })

    // Wire clientManager to idleTimeoutPolicy for daemon shutdown
    clientManager.onClientConnected(() => {
      idleTimeoutPolicy.onClientConnected()
    })
    clientManager.onClientDisconnected(() => {
      idleTimeoutPolicy.onClientDisconnected()
    })

    // State server endpoints — agent child processes request config on startup
    transportServer.onRequest<
      {projectPath: string},
      {brvConfig?: BrvConfig; spaceId: string; storagePath: string; teamId: string}
    >(TransportStateEventNames.GET_PROJECT_CONFIG, async (data) => {
      // Smart invalidation: only invalidate if config file was modified since last load
      // This prevents unnecessary disk I/O while still catching changes from
      // init/space-switch commands that write directly to disk
      const needsInvalidation = await projectStateLoader.shouldInvalidate(data.projectPath)
      if (needsInvalidation) {
        projectStateLoader.invalidate(data.projectPath)
        log(`Config invalidated due to file modification: ${data.projectPath}`)
      }

      const config = await projectStateLoader.getProjectConfig(data.projectPath)
      // Register project (idempotent) to ensure XDG storage directories exist
      const projectInfo = projectRegistry.register(data.projectPath)
      return {
        brvConfig: config,
        spaceId: config?.spaceId ?? '',
        storagePath: projectInfo.storagePath,
        teamId: config?.teamId ?? '',
      }
    })

    transportServer.onRequest<void, {isValid: boolean; sessionKey: string}>(
      TransportStateEventNames.GET_AUTH,
      async () => {
        const token = await authStateStore!.loadToken()
        return {
          isValid: token?.isValid() ?? false,
          sessionKey: token?.sessionKey ?? '',
        }
      },
    )

    // Auth reload trigger — clients signal after login/logout for immediate propagation.
    // loadToken() reads from keychain, updates cache, and fires onAuthChanged → broadcast.
    transportServer.onRequest<void, {success: boolean}>('auth:reload', async () => {
      await authStateStore!.loadToken()
      return {success: true}
    })

    // Debug endpoint — exposes daemon internal state for `brv debug` command
    transportServer.onRequest<void, unknown>('daemon:getState', () => ({
      agentIdleStatus: agentIdleTimeoutPolicy.getIdleStatus(),
      agentPool: {
        entries: agentPool!.getEntries(),
        maxSize: AGENT_POOL_MAX_SIZE,
        queue: agentPool!.getQueueState(),
        size: agentPool!.getSize(),
      },
      clients: clientManager.getAllClients().map((c) => ({
        agentName: c.agentName,
        connectedAt: c.connectedAt,
        id: c.id,
        projectPath: c.projectPath,
        type: c.type,
      })),
      daemon: {
        logPath: process.env.BRV_SESSION_LOG,
        pid: process.pid,
        port,
        startedAt: daemonStartedAt,
        uptime: Date.now() - daemonStartedAt,
        version,
      },
      daemonIdleStatus: idleTimeoutPolicy.getIdleStatus(),
      tasks: transportHandlers.getDebugState(),
      transport: {
        connectedSockets: transportServer!.getConnectedSocketCount(),
        port: transportServer!.getPort() ?? port,
        running: transportServer!.isRunning(),
      },
    }))

    // Provider config/keychain stores — shared between feature handlers and state endpoint
    const providerConfigStore = new FileProviderConfigStore()
    const providerKeychainStore = createProviderKeychainStore()

    // Clear stale provider config on startup (e.g. migration from v1 system keychain to v2 file keystore).
    // If a provider is configured but its API key is no longer accessible, disconnect it so the user
    // is returned to the onboarding flow rather than hitting a cryptic API key error mid-task.
    await clearStaleProviderConfig(providerConfigStore, providerKeychainStore)

    // State endpoint: provider config — agents request this on startup and after provider:updated
    transportServer.onRequest<void, ProviderConfigResponse>(TransportStateEventNames.GET_PROVIDER_CONFIG, async () =>
      resolveProviderConfig(providerConfigStore, providerKeychainStore),
    )

    // Feature handlers (auth, init, status, push, pull, etc.) require async OIDC discovery.
    // Placed after daemon:getState so the debug endpoint is available immediately,
    // without waiting for OIDC discovery (~400ms).
    await setupFeatureHandlers({
      authStateStore,
      broadcastToProject(projectPath, event, data) {
        broadcastToProjectRoom(projectRegistry, projectRouter, projectPath, event, data)
      },
      getActiveProjectPaths: () => clientManager.getActiveProjects(),
      log,
      projectRegistry,
      providerConfigStore,
      providerKeychainStore,
      resolveProjectPath: (clientId) => clientManager.getClient(clientId)?.projectPath,
      transport: transportServer,
    })

    // Load auth token AFTER feature handlers are registered.
    // AuthHandler's onAuthChanged/onAuthExpired callbacks must be wired first
    // so that loadToken() triggers proper broadcasts to TUI and agents.
    // Agents also request auth on-demand via state:getAuth, so this ordering is safe.
    await authStateStore.loadToken()
    authStateStore.startPolling()

    // 11. Start idle timer + register signal handlers
    idleTimeoutPolicy.start()

    process.once('SIGTERM', () => {
      log('SIGTERM received')
      shutdownHandler.shutdown().catch((error: unknown) => {
        log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
    process.once('SIGINT', () => {
      log('SIGINT received')
      shutdownHandler.shutdown().catch((error: unknown) => {
        log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
      })
    })

    log(`Daemon fully started (PID: ${process.pid}, port: ${port})`)
  } catch (error: unknown) {
    // Best-effort cleanup of anything started before the failure.
    // Each step is independent — continue cleanup even if one throws.
    if (agentPool) {
      await agentPool.shutdown().catch(() => {})
    }

    authStateStore?.stopPolling()
    heartbeatWriter?.stop()
    await transportServer?.stop().catch(() => {})
    instanceManager.release()
    throw error
  }
}

// Run the daemon
try {
  await main()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  processLog(`[Daemon] Fatal startup error: ${message}`)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
