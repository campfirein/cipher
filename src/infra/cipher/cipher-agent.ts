import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {CipherAgentServices} from '../../core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../core/interfaces/cipher/i-chat-session.js'
import type {AgentState, ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {IHistoryStorage} from '../../core/interfaces/cipher/i-history-storage.js'
import type {ByteRoverGrpcConfig, CipherLLMConfig} from './agent-service-factory.js'
import type {AgentEventBus} from './events/event-emitter.js'
import type {FileSystemService} from './file-system/file-system-service.js'
import type {MemoryManager} from './memory/memory-manager.js'
import type {ProcessService} from './process/process-service.js'
import type {SimplePromptFactory} from './system-prompt/simple-prompt-factory.js'
import type {ToolManager} from './tools/tool-manager.js'
import type {ToolProvider} from './tools/tool-provider.js'

import {createCipherAgentServices} from './agent-service-factory.js'
import {CipherAgentStateManager} from './cipher-agent-state-manager.js'
import {SessionManager} from './session/session-manager.js'

/**
 * CipherAgent - Main agent implementation
 *
 * Following Dexto's pattern: CipherAgent orchestrates sessions and delegates
 * execution to ChatSession instances. Each session maintains isolated conversation
 * context while sharing global services (tools, prompts, file system, etc.).
 *
 * Architecture:
 * - Agent creates and owns shared services (ToolManager, SystemPromptManager, etc.)
 * - SessionManager creates session-specific services (LLM, EventBus)
 * - Agent delegates execution to sessions via session.run()
 *
 * Follows two-phase initialization:
 * 1. Constructor: validates and stores config
 * 2. start(): asynchronously creates all services and SessionManager
 *
 * Backward compatible:
 * - execute(input) uses default session automatically
 * - New: execute(input, sessionId) for multi-session support
 */
export class CipherAgent implements ICipherAgent {
  // Shared services (exposed publicly for external access)
  // Made optional to avoid definite assignment assertions
  public readonly agentEventBus?: AgentEventBus
  public readonly fileSystemService?: FileSystemService
  public readonly historyStorage?: IHistoryStorage
  public readonly memoryManager?: MemoryManager
  public readonly processService?: ProcessService
  public readonly promptFactory?: SimplePromptFactory
  public readonly toolManager?: ToolManager
  public readonly toolProvider?: ToolProvider
  private readonly _brvConfig?: BrvConfig
  private _isStarted: boolean = false
  private readonly currentDefaultSessionId: string = 'default'
  private defaultSession: IChatSession | null = null
  private readonly llmConfig: CipherLLMConfig
  private sessionManager?: SessionManager
  private readonly stateManager: CipherAgentStateManager

  /**
   * Creates a new CipherAgent instance
   * Does NOT initialize services - call start() for async initialization
   *
   * @param llmConfig - LLM configuration (API key, model settings)
   * @param brvConfig - Optional ByteRover config (for custom system prompt)
   */
  public constructor(llmConfig: CipherLLMConfig, brvConfig?: BrvConfig) {
    this.llmConfig = llmConfig
    this._brvConfig = brvConfig
    this.stateManager = new CipherAgentStateManager()
  }

  /**
   * Create a new session.
   *
   * @param sessionId - Optional session ID (generates UUID if not provided)
   * @returns New or existing chat session
   */
  public async createSession(sessionId?: string): Promise<IChatSession> {
    this.ensureStarted()
    return this.getSessionManager().createSession(sessionId)
  }

  /**
   * Delete a session completely (memory + history).
   *
   * @param sessionId - Session ID to delete
   * @returns True if session existed and was deleted
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureStarted()
    return this.getSessionManager().deleteSession(sessionId)
  }

  /**
   * Execute the agent with user input.
   *
   * Following Dexto's pattern: determine target session, get or create it,
   * then delegate to session.run().
   *
   * @param input - User input string
   * @param sessionId - Optional session ID (uses 'default' if not provided)
   * @returns Agent response from LLM
   * @throws Error if agent is not started
   */
  public async execute(input: string, sessionId?: string): Promise<string> {
    // Ensure agent is started
    this.ensureStarted()

    // Determine target session (backward compatible: defaults to 'default')
    const targetSessionId = sessionId ?? this.currentDefaultSessionId

    // Get or create session (lazy loading pattern from Dexto)
    const sessionMgr = this.getSessionManager()
    const existingSession = sessionMgr.getSession(targetSessionId)
    const session = existingSession ?? (await sessionMgr.createSession(targetSessionId))

    // Cache default session for faster access
    if (targetSessionId === this.currentDefaultSessionId && !this.defaultSession) {
      this.defaultSession = session
    }

    // Increment iteration counter (agent-level state)
    const iteration = this.stateManager.incrementIteration()

    // Add execution record to history
    this.stateManager.addExecutionRecord(
      `[${new Date().toISOString()}] Iteration ${iteration}: ${input.slice(0, 100)}${input.length > 100 ? '...' : ''}`,
    )

    // DELEGATE TO SESSION
    // The ChatSession will:
    // 1. Call llmService.completeTask()
    // 2. LLM service handles agentic loop (tools, prompts, iterations)
    // 3. Events forwarded from session bus to agent bus
    const response = await session.run(input)

    return response
  }

  /**
   * Get an existing session or create a new one.
   * Useful for ensuring a session exists before pre-loading history.
   *
   * @param sessionId - Session ID to get or create
   * @returns Existing or newly created chat session
   */
  public async getOrCreateSession(sessionId: string): Promise<IChatSession> {
    this.ensureStarted()
    const sessionMgr = this.getSessionManager()
    const existingSession = sessionMgr.getSession(sessionId)
    return existingSession ?? sessionMgr.createSession(sessionId)
  }

  /**
   * Get a session by ID.
   *
   * @param sessionId - Session ID
   * @returns Session instance or undefined if not found
   */
  public getSession(sessionId: string): IChatSession | undefined {
    this.ensureStarted()
    return this.getSessionManager().getSession(sessionId)
  }

  /**
   * Get session metadata without loading full history.
   *
   * @param sessionId - Session ID
   * @returns Session metadata or undefined if not found
   */
  public async getSessionMetadata(sessionId: string): Promise<import('../../core/domain/cipher/storage/history-types.js').SessionMetadata | undefined> {
    this.ensureStarted()
    return this.getHistoryStorage().getSessionMetadata(sessionId)
  }

  /**
   * Get current agent state
   *
   * @returns Current state information
   */
  public getState(): AgentState {
    return this.stateManager.getState()
  }

  /**
   * Get the current system prompt from SimplePromptFactory
   * Useful for debugging and inspection
   *
   * @returns Current system prompt (built dynamically)
   */
  public async getSystemPrompt(): Promise<string> {
    this.ensureStarted()
    return this.getPromptFactory().buildSystemPrompt({})
  }

  /**
   * List all persisted session IDs from history storage.
   *
   * @returns Array of session IDs
   */
  public async listPersistedSessions(): Promise<string[]> {
    this.ensureStarted()
    return this.getHistoryStorage().listSessions()
  }

  /**
   * List all session IDs (in-memory only).
   *
   * @returns Array of session IDs
   */
  public listSessions(): string[] {
    this.ensureStarted()
    return this.getSessionManager().listSessions()
  }

  /**
   * Reset the agent to initial state.
   * Clears execution history, resets iteration counter, and resets default session.
   */
  public reset(): void {
    this.stateManager.reset()

    // Reset default session if it exists
    if (this.defaultSession) {
      this.defaultSession.reset()
    }

    // Emit conversation reset event (only if agent is started)
    if (this._isStarted) {
      this.getAgentEventBus().emit('cipher:conversationReset', {
        sessionId: this.currentDefaultSessionId,
      })
    }
  }

  /**
   * Start the agent - initializes all services asynchronously
   * Must be called before execute()
   *
   * @throws Error if agent is already started
   */
  public async start(): Promise<void> {
    if (this._isStarted) {
      throw new Error('CipherAgent is already started')
    }

    // Services will create necessary directories during their initialization
    // No need for upfront validation - let services handle their own setup

    // Create SHARED services only (following Dexto's pattern)
    const sharedServices: CipherAgentServices = await createCipherAgentServices(this.llmConfig, this._brvConfig)

    // Extract gRPC config from llmConfig
    const grpcConfig: ByteRoverGrpcConfig = {
      accessToken: this.llmConfig.accessToken,
      grpcEndpoint: this.llmConfig.grpcEndpoint,
      projectId: this.llmConfig.projectId,
      region: this.llmConfig.region,
      sessionKey: this.llmConfig.sessionKey,
    }

    // Extract LLM config for sessions
    const sessionLLMConfig = {
      httpReferer: this.llmConfig.httpReferer,
      maxIterations: this.llmConfig.maxIterations,
      maxTokens: this.llmConfig.maxTokens,
      model: this.llmConfig.model,
      openRouterApiKey: this.llmConfig.openRouterApiKey,
      siteName: this.llmConfig.siteName,
      temperature: this.llmConfig.temperature,
      verbose: this.llmConfig.verbose,
    }

    // Create SessionManager with shared services
    const sessionManager = new SessionManager(sharedServices, grpcConfig, sessionLLMConfig, {
      config: {
        maxSessions: 100,
        sessionTTL: 3_600_000, // 1 hour
      },
    })

    // Assign services using Object.assign for readonly properties
    Object.assign(this, {
      ...sharedServices,
      sessionManager,
    })

    this._isStarted = true
  }

  /**
   * Ensure the agent has been started and all services are initialized
   *
   * @throws Error if agent is not started or services are not initialized
   */
  private ensureStarted(): void {
    if (!this._isStarted) {
      throw new Error('CipherAgent must be started before use. Call start() first.')
    }

    // Runtime validation to ensure services were properly initialized
    if (
      !this.agentEventBus ||
      !this.fileSystemService ||
      !this.historyStorage ||
      !this.memoryManager ||
      !this.processService ||
      !this.promptFactory ||
      !this.toolManager ||
      !this.toolProvider ||
      !this.sessionManager
    ) {
      throw new Error('CipherAgent services not properly initialized. This is a bug.')
    }
  }

  /**
   * Get initialized agent event bus (guaranteed to be defined after start())
   *
   * @returns AgentEventBus instance
   * @throws Error if not initialized
   */
  private getAgentEventBus(): AgentEventBus {
    if (!this.agentEventBus) {
      throw new Error('AgentEventBus not initialized. This is a bug.')
    }

    return this.agentEventBus
  }

  /**
   * Get initialized history storage (guaranteed to be defined after start())
   *
   * @returns IHistoryStorage instance
   * @throws Error if not initialized
   */
  private getHistoryStorage(): IHistoryStorage {
    if (!this.historyStorage) {
      throw new Error('HistoryStorage not initialized. This is a bug.')
    }

    return this.historyStorage
  }

  /**
   * Get initialized prompt factory (guaranteed to be defined after start())
   *
   * @returns SimplePromptFactory instance
   * @throws Error if not initialized
   */
  private getPromptFactory(): SimplePromptFactory {
    if (!this.promptFactory) {
      throw new Error('SimplePromptFactory not initialized. This is a bug.')
    }

    return this.promptFactory
  }

  /**
   * Get initialized session manager (guaranteed to be defined after start())
   *
   * @returns SessionManager instance
   * @throws Error if not initialized
   */
  private getSessionManager(): SessionManager {
    if (!this.sessionManager) {
      throw new Error('SessionManager not initialized. This is a bug.')
    }

    return this.sessionManager
  }
}
