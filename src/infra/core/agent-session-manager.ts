import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {
  AgentAuthConfig,
  AgentLLMConfig,
  AgentSessionInfo,
  IAgentSessionManager,
} from '../../core/interfaces/session/i-agent-session-manager.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'
import {CipherAgent} from '../cipher/cipher-agent.js'

/**
 * Session entry with agent and metadata.
 */
interface SessionEntry {
  agent: ICipherAgent
  createdAt: Date
  lastActiveAt: Date
}

/**
 * Configuration for AgentSessionManager.
 */
export interface AgentSessionManagerConfig {
  /** Auth credentials */
  auth?: AgentAuthConfig
  /** Project config */
  brvConfig?: BrvConfig
  /** LLM config overrides */
  llmConfig?: Partial<AgentLLMConfig>
  /** Logger instance */
  logger?: ILogger
  /** Maximum number of concurrent sessions (default: 10) */
  maxSessions?: number
}

/**
 * AgentSessionManager - Manages long-lived CipherAgent instances at the Core level.
 *
 * Architecture v7:
 * - Each session ID maps to ONE long-lived CipherAgent
 * - Agent survives across multiple tasks (conversation turns)
 * - Agent memory and context persist within session
 * - TaskProcessor gets agent from here, passes to UseCase
 *
 * This is different from the per-chat SessionManager in cipher/session/.
 * That one manages ChatSessions within a single CipherAgent.
 * This one manages CipherAgent lifecycles at the Core/Transport level.
 *
 * Lifecycle:
 * 1. CoreProcess creates AgentSessionManager on start()
 * 2. TaskProcessor calls getOrCreateAgent(sessionId) before processing task
 * 3. Agent is passed to UseCase.execute(agent, input)
 * 4. Agent survives, ready for next task in same session
 * 5. shutdown() called on CoreProcess stop() - all agents cleaned up
 */
export class AgentSessionManager implements IAgentSessionManager {
  private auth: AgentAuthConfig | undefined
  private brvConfig: BrvConfig | undefined
  private readonly llmConfig: Partial<AgentLLMConfig>
  private readonly logger: ILogger
  private readonly maxSessions: number
  private readonly sessions = new Map<string, SessionEntry>()

  constructor(config?: AgentSessionManagerConfig) {
    this.auth = config?.auth
    this.brvConfig = config?.brvConfig
    this.llmConfig = config?.llmConfig ?? {}
    this.logger = config?.logger ?? new NoOpLogger()
    this.maxSessions = config?.maxSessions ?? 10
  }

  /**
   * Delete an agent and its session.
   */
  async deleteAgent(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return false
    }

    // Reset agent to clear memory
    entry.agent.reset()

    // Remove from map
    this.sessions.delete(sessionId)
    this.logger.info('Agent deleted', {sessionId})

    return true
  }

  /**
   * Get an existing agent (does not create).
   */
  getAgent(sessionId: string): ICipherAgent | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      // Update last active time
      entry.lastActiveAt = new Date()
    }

    return entry?.agent
  }

  /**
   * Get or create an agent for a session.
   */
  async getOrCreateAgent(sessionId: string): Promise<ICipherAgent> {
    // Check existing
    const existing = this.sessions.get(sessionId)
    if (existing) {
      existing.lastActiveAt = new Date()
      this.logger.debug('Returning existing agent', {sessionId})
      return existing.agent
    }

    // Check auth
    if (!this.auth) {
      throw new Error('Auth not configured. Call setAuth() first.')
    }

    // Check max sessions
    if (this.sessions.size >= this.maxSessions) {
      // Evict oldest session
      await this.evictOldestSession()
    }

    // Create new agent
    this.logger.info('Creating new agent', {sessionId})

    const envConfig = getCurrentConfig()
    const llmConfig = {
      accessToken: this.auth.accessToken,
      apiBaseUrl: this.llmConfig.apiBaseUrl ?? envConfig.llmApiBaseUrl,
      fileSystemConfig: {workingDirectory: process.cwd()},
      maxIterations: this.llmConfig.maxIterations ?? 50,
      maxTokens: this.llmConfig.maxTokens ?? 8192,
      model: this.llmConfig.model ?? 'gemini-2.5-pro',
      projectId: this.llmConfig.projectId ?? PROJECT,
      sessionKey: this.auth.sessionKey,
      temperature: this.llmConfig.temperature ?? 0.7,
      verbose: false,
    }

    const agent = new CipherAgent(llmConfig, this.brvConfig)
    await agent.start()

    const now = new Date()
    this.sessions.set(sessionId, {
      agent,
      createdAt: now,
      lastActiveAt: now,
    })

    this.logger.info('Agent created and started', {sessionId})
    return agent
  }

  /**
   * Get session count.
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Get info for all sessions.
   */
  getSessionsInfo(): AgentSessionInfo[] {
    return [...this.sessions.entries()].map(([id, entry]) => ({
      createdAt: entry.createdAt,
      id,
      lastActiveAt: entry.lastActiveAt,
    }))
  }

  /**
   * Check if an agent exists for session.
   */
  hasAgent(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * List all active session IDs.
   */
  listSessions(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * Set auth config.
   */
  setAuth(auth: AgentAuthConfig): void {
    this.auth = auth
    this.logger.debug('Auth config updated')
  }

  /**
   * Set project config.
   */
  setBrvConfig(config: BrvConfig): void {
    this.brvConfig = config
    this.logger.debug('BrvConfig updated', {spaceId: config.spaceId})
  }

  /**
   * Shutdown all agents and cleanup.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down all agents', {count: this.sessions.size})

    for (const [sessionId, entry] of this.sessions) {
      try {
        entry.agent.reset()
        this.logger.debug('Agent reset', {sessionId})
      } catch (error) {
        this.logger.error('Failed to reset agent', {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        })
      }
    }

    this.sessions.clear()
    this.logger.info('All agents shut down')
  }

  /**
   * Evict the oldest (least recently used) session.
   */
  private async evictOldestSession(): Promise<void> {
    let oldestId: string | undefined
    let oldestTime = Date.now()

    for (const [id, entry] of this.sessions) {
      const time = entry.lastActiveAt.getTime()
      if (time < oldestTime) {
        oldestTime = time
        oldestId = id
      }
    }

    if (oldestId) {
      this.logger.info('Evicting oldest session', {sessionId: oldestId})
      await this.deleteAgent(oldestId)
    }
  }
}

/**
 * Create a new AgentSessionManager instance.
 */
export function createAgentSessionManager(config?: AgentSessionManagerConfig): IAgentSessionManager {
  return new AgentSessionManager(config)
}
