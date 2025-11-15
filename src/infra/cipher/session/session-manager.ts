import {randomUUID} from 'node:crypto'

import type {CipherAgentServices, SessionManagerConfig} from '../../../core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../../core/interfaces/cipher/i-chat-session.js'
import type {ByteRoverGrpcConfig} from '../agent-service-factory.js'

import {createSessionServices} from '../agent-service-factory.js'
import {ChatSession} from './chat-session.js'

/**
 * Session manager.
 *
 * Manages multiple chat sessions with creation, retrieval, and deletion.
 * Each session gets its own LLM service instance with isolated context.
 *
 * Following Dexto's pattern: SessionManager uses shared services from the agent
 * and creates session-specific services (LLM, EventBus) per conversation.
 */
export class SessionManager {
  private readonly config: Required<SessionManagerConfig>
  private readonly grpcConfig: ByteRoverGrpcConfig
  private readonly llmConfig: {
    maxIterations?: number
    maxTokens?: number
    model: string
    temperature?: number
  }
  private pendingCreations = new Map<string, Promise<IChatSession>>()
  private readonly sessions: Map<string, IChatSession> = new Map()
  private readonly sharedServices: CipherAgentServices

  /**
   * Creates a new session manager
   *
   * @param sharedServices - Shared services from CipherAgent (ToolManager, SystemPromptManager, etc.)
   * @param grpcConfig - gRPC client configuration
   * @param llmConfig - LLM service configuration
   * @param llmConfig.maxIterations - Maximum iterations for agentic loop
   * @param llmConfig.maxTokens - Maximum output tokens
   * @param llmConfig.model - LLM model identifier
   * @param llmConfig.temperature - Temperature for generation
   * @param config - Session manager configuration
   */
  public constructor(
    sharedServices: CipherAgentServices,
    grpcConfig: ByteRoverGrpcConfig,
    llmConfig: {
      maxIterations?: number
      maxTokens?: number
      model: string
      temperature?: number
    },
    config?: SessionManagerConfig,
  ) {
    this.sharedServices = sharedServices
    this.grpcConfig = grpcConfig
    this.llmConfig = llmConfig
    this.config = {
      maxSessions: config?.maxSessions ?? 100,
      sessionTTL: config?.sessionTTL ?? 3_600_000, // 1 hour
    }
  }

  /**
   * Create a new chat session.
   *
   * Each session gets its own LLM service instance for isolated conversation context.
   * Following Dexto's pattern with race condition protection via pendingCreations tracker.
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
   * End a session (remove from memory, preserve history for future restoration).
   * Currently same as deleteSession since we don't have persistent storage yet.
   *
   * @param id - Session ID to end
   * @returns True if session existed and was ended
   */
  public async endSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    // In the future, this would preserve history in storage
    // For now, just remove from memory
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
   * Internal session creation logic.
   *
   * @param id - Session ID
   * @returns New chat session instance
   */
  private async createSessionInternal(id: string): Promise<IChatSession> {
    // Create session-specific services using factory
    const sessionServices = createSessionServices(id, this.sharedServices, this.grpcConfig, this.llmConfig)

    // Create session with both shared and session services
    const session = new ChatSession(id, this.sharedServices, sessionServices)

    // Initialize LLM service to load persisted history from blob storage
    // Only call initialize() if the service has the method (ByteRoverLLMService has it, GeminiLLMService doesn't)
    if ('initialize' in sessionServices.llmService && typeof sessionServices.llmService.initialize === 'function') {
      const initialized = await sessionServices.llmService.initialize()

      if (initialized) {
        console.log(`[SessionManager] Loaded history for session: ${id}`)
      }
    }

    this.sessions.set(id, session)
    return session
  }
}
