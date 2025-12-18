import type {BrvConfig} from '../../domain/entities/brv-config.js'
import type {ICipherAgent} from '../cipher/i-cipher-agent.js'

/**
 * Auth credentials for agent operations.
 */
export interface AgentAuthConfig {
  accessToken: string
  sessionKey: string
}

/**
 * LLM configuration for creating agents.
 */
export interface AgentLLMConfig {
  apiBaseUrl: string
  maxIterations?: number
  maxTokens?: number
  model: string
  projectId: string
  temperature?: number
}

/**
 * Session info returned by the manager.
 */
export interface AgentSessionInfo {
  /** When the session was created */
  createdAt: Date
  /** Session ID */
  id: string
  /** When the session was last active */
  lastActiveAt: Date
}

/**
 * Interface for managing long-lived CipherAgent instances.
 *
 * Architecture v7:
 * - Each session maps to ONE long-lived CipherAgent
 * - Agent survives across multiple tasks (conversation turns)
 * - Agent memory persists within session
 * - TaskProcessor gets agent from here, passes to UseCase
 *
 * This is different from the per-chat SessionManager in cipher/session/.
 * That one manages ChatSessions within a single CipherAgent.
 * This one manages CipherAgent instances at the Core level.
 */
export interface IAgentSessionManager {
  /**
   * Delete an agent and its session.
   *
   * @param sessionId - Session ID
   * @returns True if agent existed and was deleted
   */
  deleteAgent(sessionId: string): Promise<boolean>

  /**
   * Get an existing agent (does not create).
   *
   * @param sessionId - Session ID
   * @returns Agent or undefined if not found
   */
  getAgent(sessionId: string): ICipherAgent | undefined

  /**
   * Get or create an agent for a session.
   * If agent doesn't exist, creates and starts it.
   * If agent exists, returns the existing one.
   *
   * @param sessionId - Session ID
   * @returns Started CipherAgent instance
   */
  getOrCreateAgent(sessionId: string): Promise<ICipherAgent>

  /**
   * Get session count.
   *
   * @returns Number of active sessions
   */
  getSessionCount(): number

  /**
   * Get info for all sessions.
   *
   * @returns Array of session info
   */
  getSessionsInfo(): AgentSessionInfo[]

  /**
   * Check if an agent exists for session.
   *
   * @param sessionId - Session ID
   * @returns True if agent exists
   */
  hasAgent(sessionId: string): boolean

  /**
   * List all active session IDs.
   *
   * @returns Array of session IDs
   */
  listSessions(): string[]

  /**
   * Set auth config (can be updated at runtime).
   *
   * @param auth - Auth credentials
   */
  setAuth(auth: AgentAuthConfig): void

  /**
   * Set project config (can be updated at runtime).
   *
   * @param config - BrvConfig
   */
  setBrvConfig(config: BrvConfig): void

  /**
   * Shutdown all agents and cleanup.
   */
  shutdown(): Promise<void>
}
