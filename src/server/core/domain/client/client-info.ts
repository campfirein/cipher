/**
 * ClientInfo — In-memory entity representing a connected client.
 *
 * Tracked by ClientManager for project membership and onProjectEmpty detection.
 * Not persisted — no Zod validation needed.
 *
 * Client types:
 * - 'tui': Terminal UI (the brv REPL) — external client, long-lived
 * - 'cli': CLI headless commands (brv curate --headless, etc.) — external client, short-lived
 * - 'extension': IDE extension (e.g. VS Code extension) — external client, implemented in separate repo
 * - 'mcp': MCP protocol client (IDEs, external tools) — external client, may be global-scope
 * - 'agent': Agent worker process — NOT an external client (worker, not user)
 *
 * projectPath is undefined for global-scope MCP clients until
 * associateProject() is called on first tool call with cwd.
 */

/**
 * Valid client types (runtime source of truth).
 * Used for validation when registering clients.
 */
export const VALID_CLIENT_TYPES = ['agent', 'cli', 'extension', 'mcp', 'tui'] as const

/**
 * Client type discriminator.
 */
export type ClientType = (typeof VALID_CLIENT_TYPES)[number]

/**
 * Runtime type guard for client type validation.
 */
export function isValidClientType(value: unknown): value is ClientType {
  return typeof value === 'string' && (VALID_CLIENT_TYPES as readonly string[]).includes(value)
}

/**
 * Construction parameters for ClientInfo.
 */
type ClientInfoParams = {
  agentName?: string
  connectedAt: number
  id: string
  projectPath?: string
  type: ClientType
}

/**
 * Represents a connected client tracked by ClientManager.
 */
export class ClientInfo {
  public readonly connectedAt: number
  public readonly id: string
  public readonly type: ClientType
  /** Mutable: set via setAgentName() for MCP clients after MCP initialize handshake */
  private _agentName: string | undefined
  /** Mutable: set via associateProject() for global-scope MCP clients */
  private _projectPath: string | undefined

  constructor(params: ClientInfoParams) {
    this.id = params.id
    this.type = params.type
    this.connectedAt = params.connectedAt
    this._agentName = params.agentName
    this._projectPath = params.projectPath
  }

  /**
   * The agent name reported by the MCP client during initialize handshake.
   * Undefined for non-MCP clients or MCP clients that haven't completed handshake.
   */
  get agentName(): string | undefined {
    return this._agentName
  }

  /**
   * Whether this client has been associated with a project.
   */
  get hasProject(): boolean {
    return this._projectPath !== undefined
  }

  /**
   * Whether this client counts toward project membership for onProjectEmpty.
   * Agent clients are workers, not users — they don't count.
   */
  get isExternalClient(): boolean {
    return this.type !== 'agent'
  }

  /**
   * The project this client is associated with.
   * Undefined for global-scope MCP clients that haven't been associated yet.
   */
  get projectPath(): string | undefined {
    return this._projectPath
  }

  /**
   * Associate this client with a project path.
   * Used for global-scope MCP clients on first tool call with cwd.
   */
  associateProject(projectPath: string): void {
    this._projectPath = projectPath
  }

  /**
   * Set the agent name for this MCP client.
   * Called after MCP initialize handshake provides clientInfo.
   */
  setAgentName(agentName: string): void {
    this._agentName = agentName
  }
}
