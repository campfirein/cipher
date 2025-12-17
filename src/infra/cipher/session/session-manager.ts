import {randomUUID} from 'node:crypto'

import type {CipherAgentServices, SessionManagerConfig} from '../../../core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../../core/interfaces/cipher/i-chat-session.js'
import type {ByteRoverHttpConfig} from '../agent-service-factory.js'

import {createSessionServices} from '../agent-service-factory.js'
import {ChatSession} from './chat-session.js'
import {generateSessionTitle} from './title-generator.js'

/**
 * Metadata about a session for listing purposes.
 */
export interface SessionMetadata {
  createdAt: number
  id: string
  lastActivity: number
  messageCount: number
  title?: string
}

/**
 * Options for SessionManager constructor
 */
export interface SessionManagerOptions {
  config?: SessionManagerConfig
}

/**
 * Session manager.
 *
 * Manages multiple chat sessions with creation, retrieval, and deletion.
 * Each session gets its own LLM service instance with isolated context.
 * and creates session-specific services (LLM, EventBus) per conversation.
 */
export class SessionManager {
  private cleanupTimer?: ReturnType<typeof setInterval>
  private readonly config: Required<SessionManagerConfig>
  private readonly httpConfig: ByteRoverHttpConfig
  private readonly llmConfig: {
    httpReferer?: string
    maxIterations?: number
    maxTokens?: number
    model: string
    openRouterApiKey?: string
    siteName?: string
    temperature?: number
  }
  private pendingCreations = new Map<string, Promise<IChatSession>>()
  private readonly sessionCreatedAt: Map<string, number> = new Map()
  private readonly sessionLastActivity: Map<string, number> = new Map()
  private readonly sessions: Map<string, IChatSession> = new Map()
  private readonly sessionTitles: Map<string, string> = new Map()
  private readonly sharedServices: CipherAgentServices

  /**
   * Creates a new session manager
   *
   * @param sharedServices - Shared services from CipherAgent (ToolManager, SystemPromptManager, etc.)
   * @param httpConfig - HTTP client configuration
   * @param llmConfig - LLM service configuration
   * @param llmConfig.openRouterApiKey - Optional OpenRouter API key for direct service
   * @param llmConfig.httpReferer - Optional HTTP Referer for OpenRouter rankings
   * @param llmConfig.siteName - Optional site name for OpenRouter rankings
   * @param llmConfig.maxIterations - Maximum iterations for agentic loop
   * @param llmConfig.maxTokens - Maximum output tokens
   * @param llmConfig.model - LLM model identifier
   * @param llmConfig.temperature - Temperature for generation
   * @param options - Optional session manager options
   * @param options.config - Session manager configuration
   */
  public constructor(
    sharedServices: CipherAgentServices,
    httpConfig: ByteRoverHttpConfig,
    llmConfig: {
      httpReferer?: string
      maxIterations?: number
      maxTokens?: number
      model: string
      openRouterApiKey?: string
      siteName?: string
      temperature?: number
    },
    options?: SessionManagerOptions,
  ) {
    this.sharedServices = sharedServices
    this.httpConfig = httpConfig
    this.llmConfig = llmConfig
    this.config = {
      maxSessions: options?.config?.maxSessions ?? 100,
      sessionTTL: options?.config?.sessionTTL ?? 3_600_000, // 1 hour
    }

    // Start periodic cleanup (every 15 minutes or 1/4 TTL, whichever is smaller)
    const cleanupInterval = Math.min(15 * 60 * 1000, this.config.sessionTTL / 4)
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions().catch(() => {
        // Silently ignore cleanup errors
      })
    }, cleanupInterval)
  }

  /**
   * Create a new chat session.
   *
   * Each session gets its own LLM service instance for isolated conversation context.
   *
   * @param sessionId - Optional session ID (generates UUID if not provided)
   * @returns New or existing chat session instance
   */
  public async createSession(sessionId?: string): Promise<IChatSession> {
    const id = sessionId ?? randomUUID()

    // Check pending operations (race condition protection)
    if (this.pendingCreations.has(id)) {
      const pending = this.pendingCreations.get(id)

      if (!pending) {
        throw new Error(`Pending session ${id} not found. This is a bug.`)
      }

      return pending
    }

    // Check in-memory cache
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)

      if (!existing) {
        throw new Error(`Session ${id} not found in cache. This is a bug.`)
      }

      return existing
    }

    // Check max sessions limit
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum sessions (${this.config.maxSessions}) reached. Delete unused sessions or increase maxSessions limit.`,
      )
    }

    // Create with pending tracker
    const creationPromise = this.createSessionInternal(id)
    this.pendingCreations.set(id, creationPromise)

    try {
      return await creationPromise
    } finally {
      this.pendingCreations.delete(id)
    }
  }

  /**
   * Delete a session completely (memory + history).
   *
   * @param id - Session ID to delete
   * @returns True if session existed and was deleted
   */
  public async deleteSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    // Clear session history
    session.reset()

    // Remove from memory
    return this.sessions.delete(id)
  }

  /**
   * Stop cleanup timer and dispose of all resources.
   * Call this when shutting down the session manager.
   */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  /**
   * End a session (remove from memory, preserve history for future restoration).
   * Unlike deleteSession, this preserves the conversation history in storage
   * so the session can be restored later.
   *
   * @param id - Session ID to end
   * @returns True if session existed and was ended
   */
  public async endSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    // Ensure history is persisted before removing from memory
    const contextManager = session.getLLMService().getContextManager()
    await contextManager.flush()

    // Cleanup session resources (cancels in-flight ops, preserves history)
    session.cleanup()

    // Remove from memory only - history remains in storage
    return this.sessions.delete(id)
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session ID
   * @returns Session instance or undefined if not found
   */
  public getSession(id: string): IChatSession | undefined {
    return this.sessions.get(id)
  }

  /**
   * Get the number of active sessions.
   *
   * @returns Session count
   */
  public getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Check if a session exists.
   *
   * @param id - Session ID to check
   * @returns True if session exists
   */
  public hasSession(id: string): boolean {
    return this.sessions.has(id)
  }

  /**
   * List all session IDs.
   *
   * @returns Array of session IDs
   */
  public listSessions(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * List all sessions with metadata.
   * Returns sessions sorted by last activity (most recent first).
   *
   * @returns Array of session metadata
   */
  public listSessionsWithMetadata(): SessionMetadata[] {
    const sessions: SessionMetadata[] = []

    for (const [id, session] of this.sessions) {
      const contextManager = session.getLLMService().getContextManager()
      sessions.push({
        createdAt: this.sessionCreatedAt.get(id) ?? Date.now(),
        id,
        lastActivity: this.sessionLastActivity.get(id) ?? Date.now(),
        messageCount: contextManager.getMessages().length,
        title: this.sessionTitles.get(id),
      })
    }

    // Sort by last activity (most recent first)
    return sessions.sort((a, b) => b.lastActivity - a.lastActivity)
  }

  /**
   * Set session title from the first user message.
   * Uses heuristic extraction (no LLM call).
   *
   * @param sessionId - Session ID
   * @param firstMessage - First user message
   */
  public setSessionTitleFromMessage(sessionId: string, firstMessage: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const title = generateSessionTitle(firstMessage)
    this.sessionTitles.set(sessionId, title)
  }

  /**
   * Update the last activity timestamp for a session.
   * Should be called after each message exchange.
   *
   * @param sessionId - Session ID
   */
  public updateSessionActivity(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.sessionLastActivity.set(sessionId, Date.now())
    }
  }

  /**
   * Remove sessions that have exceeded TTL.
   *
   * @returns Number of sessions cleaned up
   */
  private async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now()
    let cleaned = 0

    for (const [id] of this.sessions) {
      const lastActivity = this.sessionLastActivity.get(id) ?? 0

      if (now - lastActivity > this.config.sessionTTL) {
        // eslint-disable-next-line no-await-in-loop
        await this.endSession(id) // Preserve history
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Internal session creation logic.
   *
   * @param id - Session ID
   * @returns New chat session instance
   */
  private async createSessionInternal(id: string): Promise<IChatSession> {
    // Create session-specific services using factory
    const sessionServices = createSessionServices(id, this.sharedServices, this.httpConfig, this.llmConfig)

    // Create session with both shared and session services
    const session = new ChatSession(id, this.sharedServices, sessionServices)

    // Initialize LLM service to load persisted history from blob storage
    // Only call initialize() if the service has the method (ByteRoverLLMService has it, GeminiLLMService doesn't)
    if ('initialize' in sessionServices.llmService && typeof sessionServices.llmService.initialize === 'function') {
      await sessionServices.llmService.initialize()
      // Debug logging removed for cleaner user experience
    }

    // Track session metadata
    const now = Date.now()
    this.sessionCreatedAt.set(id, now)
    this.sessionLastActivity.set(id, now)

    this.sessions.set(id, session)
    return session
  }
}
