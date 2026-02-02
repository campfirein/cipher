/**
 * ProjectRouter — Routes events to project-scoped Socket.IO rooms.
 *
 * Wraps ITransportServer room methods with project-specific room naming.
 * Room name format: project:<sanitizedPath>:broadcast
 *
 * Member tracking: Maintains an in-memory Set per room so that
 * getProjectMembers() is O(1) without querying the Socket.IO adapter.
 *
 * Cleanup contract: Callers (T4 ClientManager) must call
 * removeFromProjectRoom on client disconnect. Socket.IO auto-removes
 * sockets from rooms on disconnect, but the internal roomMembers map
 * requires explicit removal.
 */

import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {PROJECT_ROOM_PREFIX, PROJECT_ROOM_SUFFIX} from '../../constants.js'

type ProjectRouterOptions = {
  transport: ITransportServer
}

export class ProjectRouter implements IProjectRouter {
  /** Track room membership: roomName → Set of clientIds */
  private readonly roomMembers: Map<string, Set<string>> = new Map()
  private readonly transport: ITransportServer

  constructor(options: ProjectRouterOptions) {
    this.transport = options.transport
  }

  addToProjectRoom(clientId: string, sanitizedPath: string): void {
    const room = this.buildRoomName(sanitizedPath)
    this.transport.addToRoom(clientId, room)

    let members = this.roomMembers.get(room)
    if (!members) {
      members = new Set()
      this.roomMembers.set(room, members)
    }

    members.add(clientId)
  }

  broadcastToProject<T = unknown>(sanitizedPath: string, event: string, data: T): void {
    const room = this.buildRoomName(sanitizedPath)
    this.transport.broadcastTo(room, event, data)
  }

  getProjectMembers(sanitizedPath: string): string[] {
    const room = this.buildRoomName(sanitizedPath)
    const members = this.roomMembers.get(room)
    return members ? [...members] : []
  }

  removeFromProjectRoom(clientId: string, sanitizedPath: string): void {
    const room = this.buildRoomName(sanitizedPath)
    this.transport.removeFromRoom(clientId, room)

    const members = this.roomMembers.get(room)
    if (members) {
      members.delete(clientId)
      if (members.size === 0) {
        this.roomMembers.delete(room)
      }
    }
  }

  /**
   * Builds the Socket.IO room name from a sanitized project path.
   * Format: project:<sanitizedPath>:broadcast
   */
  private buildRoomName(sanitizedPath: string): string {
    return `${PROJECT_ROOM_PREFIX}${sanitizedPath}${PROJECT_ROOM_SUFFIX}`
  }
}
