/**
 * ConnectionCoordinator - Manages client and agent connection lifecycle.
 *
 * Handles:
 * - Agent registration/disconnection (per-project tracking)
 * - Client registration, project association, disconnection
 * - Project room management (centralised — single source of truth)
 * - Agent control commands (restart, newSession)
 *
 * Consumed by TransportHandlers (orchestrator).
 */

import {unlinkSync} from 'node:fs'
import {join} from 'node:path'

import type {ClientType} from '../../core/domain/client/client-info.js'
import type {
  AgentNewSessionRequest,
  AgentNewSessionResponse,
  AgentRestartRequest,
  AgentRestartResponse,
  AgentStatus,
} from '../../core/domain/transport/schemas.js'
import type {IAgentPool} from '../../core/interfaces/agent/i-agent-pool.js'
import type {IClientManager} from '../../core/interfaces/client/i-client-manager.js'
import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {TaskRouter} from './task-router.js'

import {isValidClientType} from '../../core/domain/client/client-info.js'
import {AgentDisconnectedError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {
  AgentStatusEventNames,
  TransportAgentEventNames,
  TransportClientEventNames,
} from '../../core/domain/transport/schemas.js'
import {eventLog, transportLog} from '../../utils/process-logger.js'
import {broadcastToProjectRoom} from './broadcast-utils.js'

type ConnectionCoordinatorOptions = {
  agentPool?: IAgentPool
  clientManager?: IClientManager
  /**
   * Daemon version surfaced in `client:register` ack. Lets clients render
   * drift indicators without a separate round-trip. Optional so older
   * deployments still build.
   */
  daemonVersion?: string
  projectRegistry?: IProjectRegistry
  projectRouter?: IProjectRouter
  taskRouter: TaskRouter
  transport: ITransportServer
}

export class ConnectionCoordinator {
  /**
   * Per-project agent tracking: projectPath → agentClientId.
   * Empty string key for backward compat when no projectPath provided.
   */
  private agentClients: Map<string, string> = new Map()
  private readonly agentPool: IAgentPool | undefined
  private readonly clientManager: IClientManager | undefined
  private readonly daemonVersion: string | undefined
  private readonly projectRegistry: IProjectRegistry | undefined
  private readonly projectRouter: IProjectRouter | undefined
  private readonly taskRouter: TaskRouter
  private readonly transport: ITransportServer

  constructor(options: ConnectionCoordinatorOptions) {
    this.transport = options.transport
    this.agentPool = options.agentPool
    this.clientManager = options.clientManager
    this.daemonVersion = options.daemonVersion
    this.projectRouter = options.projectRouter
    this.projectRegistry = options.projectRegistry
    this.taskRouter = options.taskRouter
  }

  clearAgentClients(): void {
    this.agentClients.clear()
  }

  /**
   * Get the agent client ID for a given project.
   *
   * Lookup order:
   * 1. Exact match: agent registered for this specific projectPath
   * 2. Fallback: agent registered without projectPath (empty-string key)
   * 3. Last resort: if no projectPath requested, return first available agent
   */
  getAgentForProject(projectPath?: string): string | undefined {
    if (projectPath) {
      const exact = this.agentClients.get(projectPath)
      if (exact) return exact
    }

    if (this.agentClients.has('')) {
      return this.agentClients.get('')
    }

    if (!projectPath) {
      const first = this.agentClients.values().next()
      return first.done ? undefined : first.value
    }

    return undefined
  }

  getDebugAgentClients(): Array<{clientId: string; projectPath: string}> {
    return [...this.agentClients.entries()].map(([projectPath, clientId]) => ({
      clientId,
      projectPath,
    }))
  }

  /**
   * Register all connection, agent, and client lifecycle handlers on the transport.
   */
  setup(): void {
    this.setupConnectionHandlers()
    this.setupAgentHandlers()
    this.setupClientLifecycleHandlers()
    this.setupAgentControlHandlers()
  }

  /**
   * Add a client to the project room (if projectPath and required services are available).
   * Uses register() (idempotent) to ensure the project exists in the registry,
   * so clients can join the room even before any task has been submitted.
   */
  private addToProjectRoom(clientId: string, projectPath: string): void {
    if (!this.projectRouter || !this.projectRegistry) return
    const projectInfo = this.projectRegistry.register(projectPath)
    this.projectRouter.addToProjectRoom(clientId, projectInfo.sanitizedPath)
  }

  /**
   * Clear active.json so the next agent fork creates a fresh session
   * instead of resuming the old one. Used by /new when no agent is running.
   */
  private clearActiveSession(projectPath?: string): void {
    if (!projectPath || !this.projectRegistry) return

    const projectInfo = this.projectRegistry.get(projectPath)
    if (!projectInfo) return

    try {
      unlinkSync(join(projectInfo.storagePath, 'sessions', 'active.json'))
    } catch {
      // Best-effort: file may not exist
    }
  }

  private findProjectForAgent(clientId: string): string | undefined {
    for (const [projectPath, agentId] of this.agentClients) {
      if (agentId === clientId) {
        return projectPath === '' ? undefined : projectPath
      }
    }

    return undefined
  }

  private handleAgentDisconnect(clientId: string): void {
    const projectPath = this.findProjectForAgent(clientId)
    transportLog(`Agent disconnected!${projectPath ? ` project=${projectPath}` : ''}`)

    this.removeAgentClient(clientId)

    if (projectPath) {
      this.removeFromProjectRoom(clientId, projectPath)
    }

    // Notify pool so it removes the stale agent entry
    if (projectPath) {
      this.agentPool?.handleAgentDisconnected(projectPath)
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      projectPath,
      TransportAgentEventNames.DISCONNECTED,
      {},
    )

    // Fail only tasks belonging to the disconnected agent's project
    const error = serializeTaskError(new AgentDisconnectedError())
    const tasksToFail = this.taskRouter.getTasksForProject(projectPath)
    for (const task of tasksToFail) {
      this.taskRouter.failTask(task.taskId, error)
    }
  }

  private handleAgentRegister(clientId: string, data?: {projectPath?: string; status?: AgentStatus}): void {
    const projectPath = data?.projectPath
    transportLog(`Agent registered: ${clientId}${projectPath ? `, project=${projectPath}` : ''}`)

    const agentKey = projectPath ?? ''
    this.agentClients.set(agentKey, clientId)

    if (this.clientManager) {
      this.clientManager.register(clientId, 'agent', projectPath)
    }

    if (projectPath) {
      this.addToProjectRoom(clientId, projectPath)
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      projectPath,
      TransportAgentEventNames.CONNECTED,
      {},
    )
  }

  private handleClientAssociateProject(
    clientId: string,
    data: {projectPath: string},
  ): {error?: string; success: boolean} {
    if (!this.clientManager) {
      return {error: 'ClientManager not available', success: false}
    }

    const client = this.clientManager.getClient(clientId)
    if (!client) {
      return {error: 'Client not registered', success: false}
    }

    if (client.hasProject) {
      // Idempotent: same path → no-op
      if (client.projectPath === data.projectPath) {
        return {success: true}
      }

      // Reassociation: path changed (e.g. after worktree add/remove)
      const oldPath = this.clientManager.updateProjectPath(clientId, data.projectPath)
      transportLog(`Client ${clientId} reassociated: ${oldPath} → ${data.projectPath}`)

      if (oldPath) {
        this.removeFromProjectRoom(clientId, oldPath)
      }

      this.addToProjectRoom(clientId, data.projectPath)

      return {success: true}
    }

    this.clientManager.associateProject(clientId, data.projectPath)
    transportLog(`Client ${clientId} associated with project ${data.projectPath}`)

    this.addToProjectRoom(clientId, data.projectPath)

    return {success: true}
  }

  private handleClientRegister(
    clientId: string,
    data: {clientType: ClientType; projectPath?: string},
  ): {daemonVersion?: string; error?: string; success: boolean} {
    if (!this.clientManager) {
      return {error: 'ClientManager not available', success: false}
    }

    // Fall back to 'cli' for missing/invalid clientType (backward compat with older clients)
    const clientType = isValidClientType(data.clientType) ? data.clientType : 'cli'
    if (!isValidClientType(data.clientType)) {
      transportLog(
        `Client ${clientId} registered with missing/invalid clientType '${String(data.clientType)}', defaulting to 'cli'`,
      )
    }

    this.clientManager.register(clientId, clientType, data.projectPath)
    transportLog(
      `Client registered: ${clientId} (type=${clientType}${data.projectPath ? `, project=${data.projectPath}` : ''})`,
    )

    if (clientType === 'tui' && data.projectPath) {
      transportLog(`[TUI] Session started from: ${data.projectPath}`)
    }

    if (data.projectPath) {
      this.addToProjectRoom(clientId, data.projectPath)
    }

    if (this.daemonVersion) {
      return {daemonVersion: this.daemonVersion, success: true}
    }

    return {success: true}
  }

  private handleClientUpdateAgentName(clientId: string, data: {agentName: string}): {error?: string; success: boolean} {
    if (!this.clientManager) {
      return {error: 'ClientManager not available', success: false}
    }

    const client = this.clientManager.getClient(clientId)
    if (!client) {
      return {error: 'Client not registered', success: false}
    }

    this.clientManager.setAgentName(clientId, data.agentName)
    transportLog(`Client ${clientId} identified as agent: ${data.agentName}`)

    return {success: true}
  }

  private isAgentClient(clientId: string): boolean {
    for (const agentId of this.agentClients.values()) {
      if (agentId === clientId) return true
    }

    return false
  }

  private removeAgentClient(clientId: string): void {
    for (const [projectPath, agentId] of this.agentClients) {
      if (agentId === clientId) {
        this.agentClients.delete(projectPath)
        break
      }
    }
  }

  /**
   * Remove a client from the project room.
   */
  private removeFromProjectRoom(clientId: string, projectPath: string): void {
    if (!this.projectRouter || !this.projectRegistry) return
    const projectInfo = this.projectRegistry.get(projectPath)
    if (projectInfo) {
      this.projectRouter.removeFromProjectRoom(clientId, projectInfo.sanitizedPath)
    }
  }

  private setupAgentControlHandlers(): void {
    // agent:restart - Client requests Agent to reinitialize
    this.transport.onRequest<AgentRestartRequest, AgentRestartResponse>(
      TransportAgentEventNames.RESTART,
      (data, clientId) => {
        transportLog(`Agent restart requested by ${clientId}: ${data.reason ?? 'no reason'}`)

        const clientProject = this.clientManager?.getClient(clientId)?.projectPath
        const agentId = this.getAgentForProject(clientProject)
        if (!agentId) {
          return {error: 'Agent not connected', success: false}
        }

        this.transport.sendTo(agentId, TransportAgentEventNames.RESTART, {reason: data.reason})

        eventLog('agent:restarting', {reason: data.reason})
        broadcastToProjectRoom(
          this.projectRegistry,
          this.projectRouter,
          clientProject,
          TransportAgentEventNames.RESTARTING,
          {reason: data.reason},
        )

        return {success: true}
      },
    )

    // agent:restarted - Agent reports restart result
    this.transport.onRequest<{error?: string; success: boolean}, void>(
      TransportAgentEventNames.RESTARTED,
      (data, clientId) => {
        const agentProject = this.findProjectForAgent(clientId)
        if (data.success) {
          transportLog('Agent restarted successfully')
          eventLog('agent:restarted', {success: true})
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            agentProject,
            TransportAgentEventNames.RESTARTED,
            {success: true},
          )
        } else {
          transportLog(`Agent restart failed: ${data.error}`)
          eventLog('agent:restarted', {error: data.error, success: false})
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            agentProject,
            TransportAgentEventNames.RESTARTED,
            {
              error: data.error,
              success: false,
            },
          )
        }
      },
    )

    // agent:newSession - Client requests a new session
    this.transport.onRequest<AgentNewSessionRequest, AgentNewSessionResponse>(
      TransportAgentEventNames.NEW_SESSION,
      (data, clientId) => {
        transportLog(`New session requested by ${clientId}: ${data.reason ?? 'no reason'}`)

        const clientProject = this.clientManager?.getClient(clientId)?.projectPath
        const agentId = this.getAgentForProject(clientProject)
        if (!agentId) {
          // No agent running — clear active session so next fork starts fresh
          this.clearActiveSession(clientProject)
          transportLog(`No agent running, cleared active session for: ${clientProject ?? 'unknown'}`)
          return {success: true}
        }

        this.transport.sendTo(agentId, TransportAgentEventNames.NEW_SESSION, {reason: data.reason})

        return {success: true}
      },
    )

    // agent:newSessionCreated - Agent reports new session creation result
    this.transport.onRequest<AgentNewSessionResponse, void>(
      TransportAgentEventNames.NEW_SESSION_CREATED,
      (data, clientId) => {
        const agentProject = this.findProjectForAgent(clientId)
        if (data.success) {
          transportLog(`New session created: ${data.sessionId}`)
          eventLog('agent:newSessionCreated', {sessionId: data.sessionId, success: true})
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            agentProject,
            TransportAgentEventNames.NEW_SESSION_CREATED,
            {
              sessionId: data.sessionId,
              success: true,
            },
          )
        } else {
          transportLog(`New session creation failed: ${data.error}`)
          eventLog('agent:newSessionCreated', {error: data.error, success: false})
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            agentProject,
            TransportAgentEventNames.NEW_SESSION_CREATED,
            {
              error: data.error,
              success: false,
            },
          )
        }
      },
    )
  }

  private setupAgentHandlers(): void {
    // Agent registration
    this.transport.onRequest<{projectPath?: string; status?: AgentStatus}, {success: boolean}>(
      TransportAgentEventNames.REGISTER,
      (data, clientId) => {
        this.handleAgentRegister(clientId, data)
        return {success: true}
      },
    )

    // Agent status events
    this.transport.onRequest<AgentStatus, void>(AgentStatusEventNames.STATUS_CHANGED, (data, clientId) => {
      transportLog(
        `Agent status changed: initialized=${data.isInitialized}, auth=${data.hasAuth}, config=${data.hasConfig}`,
      )
      broadcastToProjectRoom(
        this.projectRegistry,
        this.projectRouter,
        this.findProjectForAgent(clientId),
        AgentStatusEventNames.STATUS_CHANGED,
        data,
      )
    })
  }

  private setupClientLifecycleHandlers(): void {
    this.transport.onRequest<
      {clientType: ClientType; projectPath?: string},
      {daemonVersion?: string; error?: string; success: boolean}
    >(TransportClientEventNames.REGISTER, (data, clientId) => this.handleClientRegister(clientId, data))

    this.transport.onRequest<{projectPath: string}, {error?: string; success: boolean}>(
      TransportClientEventNames.ASSOCIATE_PROJECT,
      (data, clientId) => this.handleClientAssociateProject(clientId, data),
    )

    this.transport.onRequest<{agentName: string}, {error?: string; success: boolean}>(
      TransportClientEventNames.UPDATE_AGENT_NAME,
      (data, clientId) => this.handleClientUpdateAgentName(clientId, data),
    )
  }

  private setupConnectionHandlers(): void {
    this.transport.onConnection((clientId, _metadata) => {
      transportLog(`Client connected: ${clientId}`)
    })

    this.transport.onDisconnection((clientId, _metadata) => {
      transportLog(`Client disconnected: ${clientId}`)

      const isAgent = this.isAgentClient(clientId)
      if (isAgent) {
        // handleAgentDisconnect already removes from project room.
        // Wrapped in try/catch so clientManager.unregister() always runs even if
        // any step inside handleAgentDisconnect throws unexpectedly.
        try {
          this.handleAgentDisconnect(clientId)
        } catch (error) {
          transportLog(
            `Error during agent disconnect cleanup for ${clientId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      // Unregister from ClientManager (handles onProjectEmpty callback)
      if (this.clientManager) {
        const client = this.clientManager.getClient(clientId)
        // Skip room removal for agents — already handled by handleAgentDisconnect
        if (!isAgent && client?.projectPath) {
          this.removeFromProjectRoom(clientId, client.projectPath)
        }

        this.clientManager.unregister(clientId)
      }
    })
  }
}
