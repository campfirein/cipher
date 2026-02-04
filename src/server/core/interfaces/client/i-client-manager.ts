import type {ClientInfo, ClientType} from '../../domain/client/client-info.js'

/**
 * Callback fired when a project has no remaining external clients.
 * External = tui | mcp (not agent — agents are workers, not users).
 *
 * @param projectPath - The project that lost all external clients
 */
export type ProjectEmptyCallback = (projectPath: string) => void

/**
 * Manages connected client lifecycle and project membership.
 *
 * Tracks which clients are connected to which projects and fires a
 * callback when a project loses all external clients (tui/mcp).
 *
 * Client type semantics:
 * - 'tui'/'mcp' are external clients (count toward project membership)
 * - 'agent' is a worker process (does NOT count — handled by AgentPool)
 *
 * Consumed by TransportHandlers (T4) for client registration,
 * disconnect handling, and onProjectEmpty wiring.
 */
export interface IClientManager {
  /**
   * Associate a global-scope client with a project.
   * Used when an MCP client's first tool call provides a cwd.
   * After association, the client counts toward project membership
   * and onProjectEmpty tracking.
   *
   * No-op if client is unknown or already associated with a project.
   *
   * @param clientId - The client's Socket.IO ID
   * @param projectPath - The project path to associate
   */
  associateProject(clientId: string, projectPath: string): void

  /**
   * Get all projects that have at least one registered client.
   *
   * @returns Array of project paths
   */
  getActiveProjects(): string[]

  /**
   * Get a client by ID.
   *
   * @param clientId - The client's Socket.IO ID
   * @returns ClientInfo or undefined if not found
   */
  getClient(clientId: string): ClientInfo | undefined

  /**
   * Get all clients associated with a project.
   * Returns both external clients and agent clients.
   *
   * @param projectPath - The project path
   * @returns Array of ClientInfo for that project
   */
  getClientsByProject(projectPath: string): ClientInfo[]

  /**
   * Register callback for when a client connects (registers).
   * Used by IdleTimeoutPolicy to track registered clients for daemon shutdown.
   *
   * @param callback - Function called when a client registers
   */
  onClientConnected(callback: () => void): void

  /**
   * Register callback for when a client disconnects (unregisters).
   * Used by IdleTimeoutPolicy to track registered clients for daemon shutdown.
   *
   * @param callback - Function called when a client unregisters
   */
  onClientDisconnected(callback: () => void): void

  /**
   * Register callback for when a project has no external clients.
   * Called immediately when the last external client (tui/mcp) disconnects.
   * Agent clients don't count — they're workers, not users.
   *
   * @param callback - Function called with projectPath
   */
  onProjectEmpty(callback: ProjectEmptyCallback): void

  /**
   * Register a new client connection.
   *
   * @param clientId - The client's Socket.IO ID
   * @param type - The client type ('tui' | 'mcp' | 'agent')
   * @param projectPath - Optional project path (undefined for global-scope MCP)
   */
  register(clientId: string, type: ClientType, projectPath?: string): void

  /**
   * Unregister a client on disconnect.
   * Automatically checks if the client's project now has 0 external clients
   * and fires onProjectEmpty callback if so.
   *
   * @param clientId - The client's Socket.IO ID
   */
  unregister(clientId: string): void
}
