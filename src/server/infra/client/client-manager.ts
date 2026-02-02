/**
 * ClientManager — Tracks connected clients and project membership.
 *
 * Pure data structure with no external dependencies.
 * TransportHandlers coordinates between ClientManager and ProjectRouter
 * for Socket.IO room management.
 *
 * Key behaviors:
 * - Tracks all connected clients (tui, mcp, agent)
 * - Maintains a projectPath → clientIds index for fast lookup
 * - Fires onProjectEmpty when last external client leaves a project
 * - Agent clients don't count toward project membership (workers, not users)
 * - Global-scope MCP clients start without a project and get associated later
 */

import type {ClientType} from '../../core/domain/client/client-info.js'
import type {IClientManager, ProjectEmptyCallback} from '../../core/interfaces/client/i-client-manager.js'

import {ClientInfo} from '../../core/domain/client/client-info.js'

export class ClientManager implements IClientManager {
  /** All registered clients: clientId → ClientInfo */
  private readonly clients: Map<string, ClientInfo> = new Map()
  /** Project membership index: projectPath → Set of clientIds */
  private readonly projectClients: Map<string, Set<string>> = new Map()
  /** Callback for when a project has no external clients */
  private projectEmptyCallback: ProjectEmptyCallback | undefined

  associateProject(clientId: string, projectPath: string): void {
    const client = this.clients.get(clientId)
    if (!client) return
    if (client.hasProject) return

    client.associateProject(projectPath)
    this.addToProjectIndex(clientId, projectPath)
  }

  getActiveProjects(): string[] {
    return [...this.projectClients.keys()]
  }

  /**
   * Returns all registered clients for debugging.
   * Used by daemon:getState handler in server-main.ts.
   */
  getAllClients(): ClientInfo[] {
    return [...this.clients.values()]
  }

  getClient(clientId: string): ClientInfo | undefined {
    return this.clients.get(clientId)
  }

  getClientsByProject(projectPath: string): ClientInfo[] {
    const clientIds = this.projectClients.get(projectPath)
    if (!clientIds) return []

    const clients: ClientInfo[] = []
    for (const id of clientIds) {
      const client = this.clients.get(id)
      if (client) clients.push(client)
    }

    return clients
  }

  onProjectEmpty(callback: ProjectEmptyCallback): void {
    this.projectEmptyCallback = callback
  }

  register(clientId: string, type: ClientType, projectPath?: string): void {
    // Cleanup old project index if clientId already registered (reconnect scenario)
    const existing = this.clients.get(clientId)
    if (existing?.projectPath) {
      this.removeFromProjectIndex(clientId, existing.projectPath)
    }

    const client = new ClientInfo({
      connectedAt: Date.now(),
      id: clientId,
      projectPath,
      type,
    })
    this.clients.set(clientId, client)

    if (projectPath) {
      this.addToProjectIndex(clientId, projectPath)
    }
  }

  unregister(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return

    this.clients.delete(clientId)

    if (client.projectPath) {
      this.removeFromProjectIndex(clientId, client.projectPath)

      // Check if project now has 0 external clients
      if (client.isExternalClient) {
        this.checkProjectEmpty(client.projectPath)
      }
    }
  }

  private addToProjectIndex(clientId: string, projectPath: string): void {
    let members = this.projectClients.get(projectPath)
    if (!members) {
      members = new Set()
      this.projectClients.set(projectPath, members)
    }

    members.add(clientId)
  }

  /**
   * Check if a project has no remaining external clients.
   * Fires the onProjectEmpty callback if so.
   */
  private checkProjectEmpty(projectPath: string): void {
    if (!this.projectEmptyCallback) return

    const clients = this.getClientsByProject(projectPath)
    const hasExternalClients = clients.some((c) => c.isExternalClient)
    if (!hasExternalClients) {
      this.projectEmptyCallback(projectPath)
    }
  }

  private removeFromProjectIndex(clientId: string, projectPath: string): void {
    const members = this.projectClients.get(projectPath)
    if (!members) return

    members.delete(clientId)
    if (members.size === 0) {
      this.projectClients.delete(projectPath)
    }
  }
}
