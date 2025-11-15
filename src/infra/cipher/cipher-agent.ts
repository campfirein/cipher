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
import type {SystemPromptManager} from './system-prompt/system-prompt-manager.js'
import type {ToolManager} from './tools/tool-manager.js'
import type {ToolProvider} from './tools/tool-provider.js'

import {createCipherAgentServices} from './agent-service-factory.js'
import {CipherAgentStateManager} from './cipher-agent-state-manager.js'
import {SessionManager} from './session/session-manager.js'
import {validateWorkspaceInitialized} from './validation/workspace-validator.js'

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
  public readonly agentEventBus!: AgentEventBus
  public readonly fileSystemService!: FileSystemService
  public readonly historyStorage!: IHistoryStorage
  public readonly memoryManager!: MemoryManager
  public readonly processService!: ProcessService
  public readonly systemPromptManager!: SystemPromptManager
  public readonly toolManager!: ToolManager
  public readonly toolProvider!: ToolProvider
  private readonly _brvConfig?: BrvConfig
  private _isStarted: boolean = false
  private readonly currentDefaultSessionId: string = 'default'
  private defaultSession: IChatSession | null = null
  private readonly llmConfig: CipherLLMConfig
  private sessionManager!: SessionManager
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
    return this.sessionManager.createSession(sessionId)
  }

  /**
   * Delete a session completely (memory + history).
   *
   * @param sessionId - Session ID to delete
   * @returns True if session existed and was deleted
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureStarted()
    return this.sessionManager.deleteSession(sessionId)
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
    const existingSession = this.sessionManager.getSession(targetSessionId)
    const session = existingSession ?? (await this.sessionManager.createSession(targetSessionId))

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
   * Get a session by ID.
   *
   * @param sessionId - Session ID
   * @returns Session instance or undefined if not found
   */
  public getSession(sessionId: string): IChatSession | undefined {
    this.ensureStarted()
    return this.sessionManager.getSession(sessionId)
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
   * Get the current system prompt from SystemPromptManager
   * Useful for debugging and inspection
   *
   * @returns Current system prompt (built dynamically)
   */
  public async getSystemPrompt(): Promise<string> {
    this.ensureStarted()
    return this.systemPromptManager.build({})
  }

  /**
   * List all session IDs.
   *
   * @returns Array of session IDs
   */
  public listSessions(): string[] {
    this.ensureStarted()
    return this.sessionManager.listSessions()
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

    // Emit conversation reset event
    this.agentEventBus.emit('cipher:conversationReset', {
      sessionId: this.currentDefaultSessionId,
    })
  }

  /**
   * Start the agent - initializes all services asynchronously
   * Must be called before execute()
   *
   * @throws Error if agent is already started
   * @throws WorkspaceNotInitializedError if .brv directory doesn't exist
   */
  public async start(): Promise<void> {
    if (this._isStarted) {
      throw new Error('CipherAgent is already started')
    }

    // Validate workspace is initialized (throws if .brv doesn't exist)
    validateWorkspaceInitialized()

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
      maxIterations: this.llmConfig.maxIterations,
      maxTokens: this.llmConfig.maxTokens,
      model: this.llmConfig.model,
      temperature: this.llmConfig.temperature,
    }

    // Create SessionManager with shared services
    const sessionManager = new SessionManager(sharedServices, grpcConfig, sessionLLMConfig, {
      maxSessions: 100,
      sessionTTL: 3_600_000, // 1 hour
    })

    // Assign services using Object.assign for readonly properties
    Object.assign(this, {
      ...sharedServices,
      sessionManager,
    })

    this._isStarted = true
  }

  /**
   * Ensure the agent has been started
   *
   * @throws Error if agent is not started
   */
  private ensureStarted(): void {
    if (!this._isStarted) {
      throw new Error('CipherAgent must be started before use. Call start() first.')
    }
  }
}
