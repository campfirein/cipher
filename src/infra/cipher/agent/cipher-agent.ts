import {setMaxListeners} from 'node:events'

import type {AgentEventMap} from '../../../core/domain/cipher/agent-events/types.js'
import type {GenerateResponse, StreamingEvent, StreamOptions} from '../../../core/domain/cipher/streaming/types.js'
import type {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import type {CipherAgentServices} from '../../../core/interfaces/cipher/cipher-services.js'
import type {IChatSession} from '../../../core/interfaces/cipher/i-chat-session.js'
import type {AgentState, ExecutionContext, ICipherAgent} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {IHistoryStorage} from '../../../core/interfaces/cipher/i-history-storage.js'
import type {FileSystemService} from '../file-system/file-system-service.js'
import type {MemoryManager} from '../memory/memory-manager.js'
import type {ProcessService} from '../process/process-service.js'
import type {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import type {ToolManager} from '../tools/tool-manager.js'
import type {ToolProvider} from '../tools/tool-provider.js'
import type {AgentConfig} from './agent-schemas.js'

import {STREAMING_EVENT_NAMES} from '../../../core/domain/cipher/streaming/types.js'
import {AgentEventBus} from '../events/event-emitter.js'
import {SessionManager} from '../session/session-manager.js'
import {AgentError} from './agent-error.js'
import {BaseAgent} from './base-agent.js'
import {type ByteRoverHttpConfig, createCipherAgentServices} from './service-initializer.js'

/**
 * CipherAgent - Main agent implementation extending BaseAgent.
 *
 * Inherits from BaseAgent:
 * - Two-phase initialization (constructor + start)
 * - Lifecycle management (start, stop, restart)
 * - State management with session overrides
 * - Typed error handling
 * - Configuration validation (Zod)
 *
 * Architecture (DextoAgent pattern):
 * - Agent creates AgentEventBus in constructor (available before start)
 * - Agent creates and owns shared services (ToolManager, SystemPromptManager, etc.)
 * - SessionManager creates session-specific services (LLM, SessionEventBus)
 * - Agent delegates execution to sessions via session.run()
 *
 * Usage:
 * - execute(input) uses default session automatically
 * - execute(input, sessionId) for multi-session support
 */
export class CipherAgent extends BaseAgent implements ICipherAgent {
  // Private state (must come before methods)
  private readonly _agentEventBus: AgentEventBus
  private readonly _brvConfig?: BrvConfig
  private readonly activeStreamControllers: Map<string, AbortController> = new Map()
  private readonly currentDefaultSessionId: string = 'default'
  private defaultSession: IChatSession | null = null
  private sessionManager?: SessionManager

  /**
   * Creates a new CipherAgent instance.
   * Does NOT initialize services - call start() for async initialization.
   *
   * @param config - Agent configuration (Zod-validated AgentConfig)
   * @param brvConfig - Optional ByteRover config for spaceId/teamId
   */
  public constructor(config: AgentConfig, brvConfig?: BrvConfig) {
    // Call parent constructor (validates with Zod)
    super(config)

    // Create event bus early (DextoAgent pattern - available before start)
    this._agentEventBus = new AgentEventBus()

    this._brvConfig = brvConfig
  }

  // === Public Getters (expose services for backward compatibility) ===

  public get agentEventBus() {
    return this.services?.agentEventBus
  }

  public get fileSystemService(): FileSystemService | undefined {
    return this.services?.fileSystemService
  }

  public get historyStorage(): IHistoryStorage | undefined {
    return this.services?.historyStorage
  }

  public get memoryManager(): MemoryManager | undefined {
    return this.services?.memoryManager
  }

  public get processService(): ProcessService | undefined {
    return this.services?.processService
  }

  public get systemPromptManager(): SystemPromptManager | undefined {
    return this.services?.systemPromptManager
  }

  public get toolManager(): ToolManager | undefined {
    return this.services?.toolManager
  }

  public get toolProvider(): ToolProvider | undefined {
    return this.services?.toolProvider
  }

  // === Public Methods (alphabetical order) ===

  /**
   * Cancels the currently running turn for a session.
   * Safe to call even if no run is in progress.
   *
   * @param sessionId - Session ID to cancel
   * @returns true if a run was in progress and was signaled to abort; false otherwise
   */
  public async cancel(sessionId: string): Promise<boolean> {
    this.ensureStarted()

    // Defensive runtime validation
    if (!sessionId || typeof sessionId !== 'string') {
      throw AgentError.serviceNotInitialized('sessionId is required and must be a non-empty string')
    }

    // Abort the stream iterator first (so consumer's for-await loop exits cleanly)
    const streamController = this.activeStreamControllers.get(sessionId)
    if (streamController) {
      streamController.abort()
      this.activeStreamControllers.delete(sessionId)
    }

    // Then cancel the session's LLM/tool execution
    const session = this.getSessionManagerInternal().getSession(sessionId)
    if (session) {
      session.cancel()
      return true
    }

    // If no session found but stream was aborted, still return true
    return Boolean(streamController)
  }

  protected override async cleanupServices(): Promise<void> {
    // Dispose session manager
    if (this.sessionManager) {
      this.sessionManager.dispose()
      this.sessionManager = undefined
    }

    // Reset execution state (only if state manager exists - may not during early cleanup)
    if (this.stateManager) {
      this.stateManager.reset()
    }

    this.defaultSession = null
  }

  /**
   * Create a new session.
   */
  public async createSession(sessionId?: string): Promise<IChatSession> {
    this.ensureStarted()
    return this.getSessionManagerInternal().createSession(sessionId)
  }

  /**
   * Delete a session completely (memory + history).
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureStarted()

    // Clear session config overrides
    if (this.stateManager) {
      this.stateManager.clearSessionOverride(sessionId)
    }

    return this.getSessionManagerInternal().deleteSession(sessionId)
  }

  /**
   * Execute the agent with user input.
   * Internally uses generate() for single code path maintainability.
   */
  public async execute(input: string, trackingSessionId?: string, options?: {executionContext?: ExecutionContext}): Promise<string> {
    this.ensureStarted()

    // Determine target session (backward compatible: defaults to 'default')
    const targetSessionId = trackingSessionId ?? this.currentDefaultSessionId

    // Use generate() internally for single code path
    const response = await this.generate(input, targetSessionId, {
      executionContext: options?.executionContext,
    })

    return response.content
  }

  /**
   * Generate a complete response (waits for full completion).
   * Wrapper around stream() that collects all events and returns final result.
   *
   * @param input - User message
   * @param trackingSessionId - Tracking session ID for backend metrics
   * @param options - Optional configuration
   * @returns Complete response with content, usage, and tool calls
   */
  public async generate(input: string, trackingSessionId: string, options?: StreamOptions): Promise<GenerateResponse> {
    // Collect all events from stream
    const events: StreamingEvent[] = []

    for await (const event of await this.stream(input, trackingSessionId, options)) {
      events.push(event)
    }

    // Check for non-recoverable error events
    const fatalErrorEvent = events.find(
      (e): e is Extract<StreamingEvent, {name: 'llmservice:error'}> =>
        e.name === 'llmservice:error' && e.recoverable !== true,
    )
    if (fatalErrorEvent) {
      throw new Error(fatalErrorEvent.error)
    }

    // Find the final response event
    const responseEvent = events.find((e) => e.name === 'llmservice:response')
    if (!responseEvent || responseEvent.name !== 'llmservice:response') {
      throw new Error('Stream did not complete successfully - no response received')
    }

    // Collect tool calls
    const toolCallEvents = events.filter(
      (e): e is Extract<StreamingEvent, {name: 'llmservice:toolCall'}> => e.name === 'llmservice:toolCall',
    )
    const toolResultEvents = events.filter(
      (e): e is Extract<StreamingEvent, {name: 'llmservice:toolResult'}> => e.name === 'llmservice:toolResult',
    )

    const toolCalls = toolCallEvents.map((tc) => {
      const toolResult = toolResultEvents.find((tr) => tr.callId === tc.callId)
      return {
        args: tc.args,
        callId: tc.callId ?? `tool_${Date.now()}`,
        result: toolResult ? {data: toolResult.result, success: toolResult.success} : undefined,
        toolName: tc.toolName,
      }
    })

    const defaultUsage = {inputTokens: 0, outputTokens: 0, totalTokens: 0}

    return {
      content: responseEvent.content,
      reasoning: responseEvent.reasoning,
      sessionId: trackingSessionId,
      toolCalls,
      usage: responseEvent.tokenUsage ?? defaultUsage,
    }
  }

  /**
   * Get an existing session or create a new one.
   */
  public async getOrCreateSession(sessionId: string): Promise<IChatSession> {
    this.ensureStarted()
    const sessionMgr = this.getSessionManagerInternal()
    const existingSession = sessionMgr.getSession(sessionId)
    return existingSession ?? sessionMgr.createSession(sessionId)
  }

  /**
   * Get a session by ID.
   */
  public getSession(sessionId: string): IChatSession | undefined {
    this.ensureStarted()
    return this.getSessionManagerInternal().getSession(sessionId)
  }

  /**
   * Get session metadata without loading full history.
   */
  public async getSessionMetadata(
    sessionId: string,
  ): Promise<import('../../../core/domain/cipher/storage/history-types.js').SessionMetadata | undefined> {
    this.ensureStarted()
    return this.getHistoryStorageInternal().getSessionMetadata(sessionId)
  }

  /**
   * Get current agent state.
   * Returns default state if agent is not yet started.
   */
  public getState(): AgentState {
    // Return default state if not started yet (for backward compatibility)
    if (!this.stateManager) {
      return {
        currentIteration: 0,
        executionHistory: [],
        executionState: 'idle',
        toolCallsExecuted: 0,
      }
    }

    return this.stateManager.getExecutionState()
  }

  /**
   * Get the current system prompt.
   */
  public async getSystemPrompt(): Promise<string> {
    this.ensureStarted()
    return this.getSystemPromptManagerInternal().build({})
  }

  protected override async initializeServices(): Promise<CipherAgentServices> {
    // Pass pre-created event bus to service initializer (DextoAgent pattern)
    return createCipherAgentServices(this.config, this._agentEventBus)
  }

  /**
   * List all persisted session IDs from history storage.
   */
  public async listPersistedSessions(): Promise<string[]> {
    this.ensureStarted()
    return this.getHistoryStorageInternal().listSessions()
  }

  /**
   * List all session IDs (in-memory only).
   */
  public listSessions(): string[] {
    this.ensureStarted()
    return this.getSessionManagerInternal().listSessions()
  }

  // === Protected Methods (implement abstract from BaseAgent) ===

  /**
   * Reset the agent to initial state.
   */
  public reset(): void {
    // Reset execution state (only if state manager exists - may not if not started)
    if (this.stateManager) {
      this.stateManager.reset()
    }

    // Reset default session if it exists
    if (this.defaultSession) {
      this.defaultSession.reset()
    }

    // Emit conversation reset event (only if agent is started)
    if (this._isStarted && this.services?.agentEventBus) {
      this.services.agentEventBus.emit('cipher:conversationReset', {
        sessionId: this.currentDefaultSessionId,
      })
    }
  }

  /**
   * Start the agent - initializes all services asynchronously.
   * Must be called before execute().
   */
  public override async start(): Promise<void> {
    // Call parent start (creates services)
    await super.start()

    // Create SessionManager with shared services
    const services = this.getServices()

    // Extract HTTP config
    const httpConfig: ByteRoverHttpConfig = {
      accessToken: this.config.accessToken,
      apiBaseUrl: this.config.apiBaseUrl,
      projectId: this.config.projectId,
      region: this.config.region,
      sessionKey: this.config.sessionKey,
      spaceId: this.config.spaceId ?? this._brvConfig?.spaceId ?? '',
      teamId: this.config.teamId ?? this._brvConfig?.teamId ?? '',
    }

    // Extract LLM config for sessions
    const sessionLLMConfig = {
      httpReferer: this.config.httpReferer,
      maxIterations: this.config.llm.maxIterations,
      maxTokens: this.config.llm.maxTokens,
      model: this.config.model,
      openRouterApiKey: this.config.openRouterApiKey,
      siteName: this.config.siteName,
      temperature: this.config.llm.temperature,
      verbose: this.config.llm.verbose,
    }

    // Create SessionManager
    this.sessionManager = new SessionManager(services, httpConfig, sessionLLMConfig, {
      config: {
        maxSessions: this.config.sessions.maxSessions,
        sessionTTL: this.config.sessions.sessionTTL,
      },
    })
  }

  /**
   * Stream a response with real-time event emission.
   *
   * @param input - User message
   * @param trackingSessionId - Tracking session ID for backend metrics
   * @param options - Optional configuration (signal for cancellation)
   * @returns AsyncIterator that yields StreamingEvent objects
   */
  public async stream(
    input: string,
    trackingSessionId: string,
    options?: StreamOptions,
  ): Promise<AsyncIterableIterator<StreamingEvent>> {
    this.ensureStarted()

    // Validate trackingSessionId is provided
    if (!trackingSessionId) {
      throw AgentError.serviceNotInitialized('trackingSessionId is required for streaming')
    }

    const signal = options?.signal

    // Event queue for aggregation
    const eventQueue: StreamingEvent[] = []
    let completed = false

    // Create AbortController for cleanup
    const controller = new AbortController()
    const cleanupSignal = controller.signal

    // Store controller so cancel() can abort this stream
    this.activeStreamControllers.set(trackingSessionId, controller)

    // Increase listener limit - stream() registers many event listeners
    setMaxListeners(30, cleanupSignal)

    // Track listener references for manual cleanup
    const listeners: Array<{
      event: string
      listener: (payload?: unknown) => void
    }> = []

    // Get the agent event bus
    const agentEventBus = this.services?.agentEventBus
    if (!agentEventBus) {
      throw AgentError.serviceNotInitialized('AgentEventBus')
    }

    // Cleanup function to remove all listeners and stream controller
    const cleanupListeners = () => {
      if (listeners.length === 0) {
        return // Already cleaned up
      }

      for (const {event, listener} of listeners) {
        agentEventBus.off(event as keyof typeof agentEventBus, listener)
      }

      listeners.length = 0
      // Remove from active controllers map
      this.activeStreamControllers.delete(trackingSessionId)
    }

    // Wire external signal to trigger cleanup
    if (signal) {
      const abortHandler = () => {
        cleanupListeners()
        controller.abort()
      }

      signal.addEventListener('abort', abortHandler, {once: true})
    }

    // Subscribe to streaming events (filter by trackingSessionId)
    for (const eventName of STREAMING_EVENT_NAMES) {
      const listener = (payload: unknown) => {
        const data = payload as {sessionId?: string}
        if (data.sessionId !== trackingSessionId) return

        // Add event to queue with name discriminant
        eventQueue.push({name: eventName, ...data} as StreamingEvent)

        // Close iterator on run:complete
        if (eventName === 'run:complete') {
          completed = true
        }
      }

      agentEventBus.on(eventName, listener, {signal: cleanupSignal})
      listeners.push({event: eventName, listener})
    }

    // Start streaming in background (fire-and-forget)
    ;(async () => {
      try {
        // Get or create session
        const sessionMgr = this.getSessionManagerInternal()
        const existingSession = sessionMgr.getSession(trackingSessionId)
        const session = existingSession ?? (await sessionMgr.createSession(trackingSessionId))

        // Cache default session for faster access
        if (trackingSessionId === this.currentDefaultSessionId && !this.defaultSession) {
          this.defaultSession = session
        }

        // Increment iteration counter
        this.getStateManager().incrementIteration()

        // Call session.streamRun() which emits events and run:complete
        await session.streamRun(input, {
          executionContext: options?.executionContext,
          signal,
        })
      } catch (error_) {
        // Emit error event if something goes wrong
        completed = true
        const error = error_ instanceof Error ? error_ : new Error(String(error_))

        eventQueue.push({
          code: undefined,
          error: error.message,
          name: 'llmservice:error',
          recoverable: false,
          sessionId: trackingSessionId,
        })
      }
    })()

    // Resolve function for waiting - will be called when new events arrive
    let notifyNewEvent: (() => void) | null = null

    // Wrap the original listener to also notify waiters
    const originalListeners = [...listeners]
    listeners.length = 0

    for (const {event, listener: originalListener} of originalListeners) {
      const wrappedListener = (payload: unknown) => {
        originalListener(payload)
        // Notify any waiting next() call
        if (notifyNewEvent) {
          notifyNewEvent()
          notifyNewEvent = null
        }
      }

      agentEventBus.off(event as keyof AgentEventMap, originalListener)
      agentEventBus.on(event as keyof AgentEventMap, wrappedListener, {signal: cleanupSignal})
      listeners.push({event, listener: wrappedListener})
    }

    // Return async iterable iterator
    const iterator: AsyncIterableIterator<StreamingEvent> = {
      async next(): Promise<IteratorResult<StreamingEvent>> {
        // If we already have events, return immediately
        if (eventQueue.length > 0) {
          return {done: false, value: eventQueue.shift()!}
        }

        // If already completed, cleanup and return
        if (completed) {
          cleanupListeners()
          return {done: true, value: undefined}
        }

        // Check for abort
        if (signal?.aborted || cleanupSignal.aborted) {
          cleanupListeners()
          return {done: true, value: undefined}
        }

        // Wait for new events
        await new Promise<void>((resolve) => {
          notifyNewEvent = resolve

          // Also resolve on abort
          const abortHandler = () => {
            notifyNewEvent = null
            resolve()
          }

          cleanupSignal.addEventListener('abort', abortHandler, {once: true})
          if (signal) {
            signal.addEventListener('abort', abortHandler, {once: true})
          }
        })

        // After waiting, check state again
        if (signal?.aborted || cleanupSignal.aborted) {
          cleanupListeners()
          return {done: true, value: undefined}
        }

        if (eventQueue.length > 0) {
          return {done: false, value: eventQueue.shift()!}
        }

        if (completed) {
          cleanupListeners()
          return {done: true, value: undefined}
        }

        // Recursive call to handle edge cases
        return iterator.next()
      },

      async return(): Promise<IteratorResult<StreamingEvent>> {
        // Called when consumer breaks out early or explicitly calls return()
        cleanupListeners()
        controller.abort()
        return {done: true, value: undefined}
      },

      [Symbol.asyncIterator]() {
        return iterator
      },
    }

    return iterator
  }

  // === Private Helpers (alphabetical order) ===

  private getHistoryStorageInternal(): IHistoryStorage {
    const storage = this.services?.historyStorage
    if (!storage) {
      throw AgentError.serviceNotInitialized('HistoryStorage')
    }

    return storage
  }

  private getSessionManagerInternal(): SessionManager {
    if (!this.sessionManager) {
      throw AgentError.serviceNotInitialized('SessionManager')
    }

    return this.sessionManager
  }

  private getSystemPromptManagerInternal(): SystemPromptManager {
    const manager = this.services?.systemPromptManager
    if (!manager) {
      throw AgentError.serviceNotInitialized('SystemPromptManager')
    }

    return manager
  }
}
