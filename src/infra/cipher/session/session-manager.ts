import {GoogleGenAI} from '@google/genai'
import {randomUUID} from 'node:crypto'

import type {SessionConfig} from '../../../core/domain/cipher/session/types.js'
import type {IChatSession} from '../../../core/interfaces/cipher/i-chat-session.js'
import type {GeminiServiceConfig} from '../llm/gemini-llm-service.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {SessionEventBus} from '../events/event-emitter.js'
import {GeminiLLMService} from '../llm/gemini-llm-service.js'
import {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import {ChatSession} from './chat-session.js'

/**
 * Session manager.
 *
 * Manages multiple chat sessions with creation, retrieval, and deletion.
 * Each session gets its own LLM service instance with isolated context.
 */
export class SessionManager {
  private readonly llmConfig: GeminiServiceConfig
  private readonly sessions: Map<string, IChatSession> = new Map()
  private readonly toolManager: ToolManager

  /**
   * Creates a new session manager
   *
   * @param llmConfig - LLM service configuration
   * @param toolManager - Tool manager for tool execution
   */
  public constructor(llmConfig: GeminiServiceConfig, toolManager: ToolManager) {
    this.llmConfig = llmConfig
    this.toolManager = toolManager
  }

  /**
   * Create a new chat session.
   *
   * Each session gets its own LLM service instance for isolated conversation context.
   *
   * @param _config - Optional session configuration (not used yet, reserved for future)
   * @returns New chat session instance
   */
  public createSession(_config?: SessionConfig): IChatSession {
    const id = randomUUID()

    // Create default system prompt manager for the session
    const systemPromptManager = new SystemPromptManager({
      contributors: [
        {
          content: 'You are a helpful AI assistant.',
          enabled: true,
          id: 'static',
          priority: 0,
          type: 'static',
        },
      ],
    })

    // Create session event bus for this session
    const sessionEventBus = new SessionEventBus()

    // Create GoogleGenAI client
    const geminiClient = new GoogleGenAI({apiKey: this.llmConfig.apiKey})

    // Create a new LLM service for this session
    // Each session has isolated context via its own service + ContextManager
    const llmService = new GeminiLLMService(id, geminiClient, this.llmConfig, {
      sessionEventBus,
      systemPromptManager,
      toolManager: this.toolManager,
    })

    // Create the session with the dedicated service
    const session = new ChatSession(id, llmService)

    this.sessions.set(id, session)
    return session
  }

  /**
   * Delete a session.
   *
   * @param id - Session ID to delete
   * @returns True if session existed and was deleted
   */
  public deleteSession(id: string): boolean {
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
}