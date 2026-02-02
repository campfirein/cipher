/**
 * Project-scoped event routing.
 *
 * Wraps transport room operations with project-specific room naming,
 * providing a clean API for broadcasting events to project members.
 *
 * Room naming convention: project:<sanitizedPath>:broadcast
 *
 * Consumed by TransportHandlers (T3) and ClientManager (T4) for
 * project-scoped event delivery.
 */
export interface IProjectRouter {
  /**
   * Add a client to a project's broadcast room.
   * Uses the project's sanitizedPath to derive the Socket.IO room name.
   *
   * @param clientId - The Socket.IO client ID
   * @param sanitizedPath - The sanitized project path (from ProjectInfo)
   */
  addToProjectRoom(clientId: string, sanitizedPath: string): void

  /**
   * Broadcast an event to all clients in a project's broadcast room.
   *
   * @param sanitizedPath - The sanitized project path
   * @param event - The event name
   * @param data - The event payload
   */
  broadcastToProject<T = unknown>(sanitizedPath: string, event: string, data: T): void

  /**
   * Get the list of client IDs currently in a project's broadcast room.
   * Returns an empty array if no clients are in the room.
   *
   * @param sanitizedPath - The sanitized project path
   * @returns Array of client IDs in the project room
   */
  getProjectMembers(sanitizedPath: string): string[]

  /**
   * Remove a client from a project's broadcast room.
   *
   * @param clientId - The Socket.IO client ID
   * @param sanitizedPath - The sanitized project path
   */
  removeFromProjectRoom(clientId: string, sanitizedPath: string): void
}
