import type {ClientInfo, ClientType} from '../../domain/client/client-info.js'

/**
 * Callback fired when a project has no remaining external clients.
 * External = tui | cli | extension | mcp (not agent — agents are workers, not users).
 *
 * @param projectPath - The project that lost all external clients
 */
export type ProjectEmptyCallback = (projectPath: string) => void

/**
 * Manages connected client lifecycle and project membership.
 *
 * Tracks which clients are connected to which projects and fires a
 * callback when a project loses all external clients.
 *
 * Client type semantics:
 * - 'tui'/'cli'/'extension'/'mcp' are external clients (count toward project membership)
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
   * Get all registered clients (for debugging).
   * Used by daemon:getState handler.
   *
   * @returns Array of all ClientInfo
   */
  getAllClients(): ClientInfo[]

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
   * Only one callback supported — subsequent calls overwrite previous.
   *
   * @param callback - Function called when a client registers
   */
  onClientConnected(callback: () => void): void

  /**
   * Register callback for when a client disconnects (unregisters).
   * Used by IdleTimeoutPolicy to track registered clients for daemon shutdown.
   *
   * Only one callback supported — subsequent calls overwrite previous.
   *
   * @param callback - Function called when a client unregisters
   */
  onClientDisconnected(callback: () => void): void

  /**
   * Register callback for when a project has no external clients.
   * Called immediately when the last external client (tui/mcp) disconnects.
   * Agent clients don't count — they're workers, not users.
   *
   * Only one callback supported — subsequent calls overwrite previous.
   *
   * @param callback - Function called with projectPath
   */
  onProjectEmpty(callback: ProjectEmptyCallback): void

  /**
   * Register a new client connection.
   *
   * @param clientId - The client's Socket.IO ID
   * @param type - The client type ('tui' | 'cli' | 'extension' | 'mcp' | 'agent')
   * @param projectPath - Optional project path (undefined for global-scope MCP)
   */
  register(clientId: string, type: ClientType, projectPath?: string): void

  /**
   * Set the agent name for an MCP client.
   * Called when the MCP initialize handshake provides clientInfo with the agent name.
   *
   * No-op if client is unknown.
   *
   * @param clientId - The client's Socket.IO ID
   * @param agentName - The agent name from MCP clientInfo (e.g., "Windsurf", "Claude Code")
   */
  setAgentName(clientId: string, agentName: string): void

  /**
   * Unregister a client on disconnect.
   * Automatically checks if the client's project now has 0 external clients
   * and fires onProjectEmpty callback if so.
   *
   * @param clientId - The client's Socket.IO ID
   */
  unregister(clientId: string): void

  /**
   * Update a client's project path, even if already associated.
   * Used for reassociation after worktree add/remove operations.
   * Moves the client from the old project index to the new one,
   * and fires onProjectEmpty if the old project has no remaining external clients.
   *
   * No-op if client is unknown.
   *
   * @param clientId - The client's Socket.IO ID
   * @param newProjectPath - The new project path to associate
   * @returns The previous project path (undefined if client not found or not previously associated)
   */
  updateProjectPath(clientId: string, newProjectPath: string): string | undefined
}
