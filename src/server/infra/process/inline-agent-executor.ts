/**
 * InlineAgent - Ephemeral in-process CipherAgent for headless commands.
 *
 * Used by `brv curate --headless` and `brv query --headless` to execute tasks
 * without requiring a running REPL instance or Transport/Socket.IO infrastructure.
 *
 * Exposes a `transportClient` property (ITransportClient) so use cases can use it
 * as a drop-in replacement for SocketIOTransportClient.
 *
 * Lifecycle:
 * 1. InlineAgent.create() — loads auth, config, starts CipherAgent
 * 2. Use case gets inlineAgent.transportClient and calls on()/request() as normal
 * 3. transportClient.disconnect() — stops CipherAgent and cleans up
 */

import {
  ConnectionState,
  ConnectionStateHandler,
  EventHandler,
  ITransportClient,
  RequestOptions,
} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'

import {AgentEventMap} from '../../../agent/core/domain/agent-events/index.js'
import {CipherAgent} from '../../../agent/infra/agent/index.js'
import {FileSystemService} from '../../../agent/infra/file-system/file-system-service.js'
import {createSearchKnowledgeService} from '../../../agent/infra/tools/implementations/search-knowledge-service.js'
import {getCurrentConfig} from '../../config/environment.js'
import {DEFAULT_LLM_MODEL, PROJECT} from '../../constants.js'
import {NotAuthenticatedError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {LlmEventNames, TransportTaskEventNames} from '../../core/domain/transport/schemas.js'
import {getProjectDataDir} from '../../utils/path-utils.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {CurateExecutor, QueryExecutor} from '../executor/index.js'
import {createTokenStore} from '../storage/token-store.js'

/**
 * Ephemeral in-process CipherAgent for headless CLI commands.
 *
 * Creates and owns a CipherAgent, and exposes an ITransportClient that
 * use cases interact with exactly like a SocketIOTransportClient.
 */
export class InlineAgent {
  public readonly transportClient: ITransportClient

  private constructor(agent: CipherAgent, queryExecutor: QueryExecutor) {
    this.transportClient = new InlineTransportClient(agent, queryExecutor)
  }

  /**
   * Async factory — loads auth/config, creates and starts CipherAgent.
   *
   * @throws NotAuthenticatedError if no auth token or token is expired
   * @throws Error if no project config (.brv/config.json) exists
   */
  static async create(): Promise<InlineAgent> {
    const tokenStore = createTokenStore()
    const configStore = new ProjectConfigStore()

    const authToken = await tokenStore.load()
    if (!authToken || authToken.isExpired()) {
      throw new NotAuthenticatedError()
    }

    const brvConfig = await configStore.read()
    if (!brvConfig) {
      throw new Error('Project not initialized. Run `brv` then `/init` first.')
    }

    const envConfig = getCurrentConfig()
    const agentConfig = {
      apiBaseUrl: envConfig.llmApiBaseUrl,
      fileSystem: {workingDirectory: process.cwd()},
      llm: {
        maxIterations: 10,
        maxTokens: 4096,
        temperature: 0.7,
        topK: 10,
        topP: 0.95,
        verbose: false,
      },
      model: DEFAULT_LLM_MODEL,
      projectId: PROJECT,
      sessionKey: authToken.sessionKey,
      storagePath: getProjectDataDir(process.cwd()),
    }

    const agent = new CipherAgent(agentConfig, brvConfig)
    await agent.start()

    const sessionId = `inline-session-${randomUUID()}`
    await agent.createSession(sessionId)

    // Create FileSystemService for smart routing and caching
    const fileSystemService = new FileSystemService()
    await fileSystemService.initialize()
    const searchService = createSearchKnowledgeService(fileSystemService)
    const queryExecutor = new QueryExecutor({
      enableCache: true,
      fileSystem: fileSystemService,
      searchService,
    })

    return new InlineAgent(agent, queryExecutor)
  }
}

/**
 * ITransportClient backed by an in-process CipherAgent.
 *
 * Translates transport events (task:create, task:completed, llmservice:*) into
 * direct CipherAgent execution via CurateExecutor/QueryExecutor.
 */
class InlineTransportClient implements ITransportClient {
  private activeTask: Promise<void> | undefined
  private readonly agent: CipherAgent
  private readonly clientId = `inline-${randomUUID()}`
  private readonly curateExecutor: CurateExecutor
  private readonly handlers = new Map<string, Set<EventHandler>>()
  private readonly queryExecutor: QueryExecutor

  constructor(agent: CipherAgent, queryExecutor: QueryExecutor) {
    this.agent = agent
    this.curateExecutor = new CurateExecutor()
    this.queryExecutor = queryExecutor
  }

  // ===========================================================================
  // ITransportClient implementation
  // ===========================================================================

  async connect(): Promise<void> {
    // No-op — initialization done in InlineAgent.create()
  }

  async disconnect(): Promise<void> {
    this.handlers.clear()

    // Stop the agent first — this causes any in-flight execute() to fail,
    // which settles the activeTask promise.
    try {
      await this.agent.stop()
    } catch {
      // Best-effort cleanup
    }

    // Wait for the task to settle (will resolve/reject quickly after agent.stop())
    if (this.activeTask) {
      await this.activeTask
      this.activeTask = undefined
    }
  }

  getClientId(): string {
    return this.clientId
  }

  getState(): ConnectionState {
    return 'connected'
  }

  async isConnected(): Promise<boolean> {
    return true
  }

  async joinRoom(): Promise<void> {
    // No-op
  }

  async leaveRoom(): Promise<void> {
    // No-op
  }

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }

    const handlerSet = this.handlers.get(event)!
    // EventHandler<T> → EventHandler<unknown>: type erasure is standard for event emitter
    // implementations — the Map is keyed by event name, so handler type is correct at runtime.
    handlerSet.add(handler as EventHandler)

    return () => {
      handlerSet.delete(handler as EventHandler)
    }
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    const unsubscribe = this.on<T>(event, (data) => {
      unsubscribe()
      handler(data)
    })
  }

  onStateChange(_handler: ConnectionStateHandler): () => void {
    // No-op — state never changes
    return () => {}
  }

  request(event: string, data?: unknown): void
  request<T = unknown>(event: string, data: unknown, ack: (response: T) => void): void
  request<T = unknown>(event: string, data?: unknown, ack?: (response: T) => void): void {
    // requestWithAck should not throw — task errors are emitted as task:error events.
    // Log unexpected infrastructure failures to stderr for diagnostics.
    const onError = (error: unknown): void => {
      process.stderr.write(`[InlineTransportClient] Unexpected error for '${event}': ${error instanceof Error ? error.message : String(error)}\n`)
    }

    const promise = this.requestWithAck(event, data)
    if (ack) {
      promise.then((response) => ack(response as T)).catch(onError)
    } else {
      promise.catch(onError)
    }
  }

  async requestWithAck<TResponse = unknown, TRequest = unknown>(
    event: string,
    data?: TRequest,
    _options?: RequestOptions,
  ): Promise<TResponse> {
    if (event === TransportTaskEventNames.CREATE) {
      // Returns immediately with {taskId}; execution runs asynchronously.
      // Single cast: handleTaskCreate returns unknown, caller expects TResponse ({taskId}).
      return this.handleTaskCreate(data as Record<string, unknown>) as TResponse
    }

    // Other events are no-ops for inline execution
    return undefined as unknown as TResponse
  }

  // ===========================================================================
  // Internal task execution
  // ===========================================================================

  /**
   * Emit an event to all registered handlers.
   */
  private emit(event: string, data: unknown): void {
    const handlerSet = this.handlers.get(event)
    if (handlerSet) {
      for (const handler of handlerSet) {
        handler(data)
      }
    }
  }

  /**
   * Execute the task in-process, emitting transport-shaped events as it progresses.
   */
  private async executeTask(data: Record<string, unknown>): Promise<void> {
    const taskId = data.taskId as string
    const type = data.type as 'curate' | 'query'
    const content = data.content as string
    const files = data.files as string[] | undefined
    const clientCwd = data.clientCwd as string | undefined

    // Emit task:ack
    this.emit(TransportTaskEventNames.ACK, {taskId})

    // Emit task:started
    this.emit(TransportTaskEventNames.STARTED, {taskId})

    // Subscribe to agentEventBus and forward events to registered handlers
    const cleanupForwarders = this.setupEventForwarding(taskId)

    try {
      const result = await (type === 'curate'
        ? this.curateExecutor.executeWithAgent(this.agent, {
            clientCwd,
            content,
            files,
            taskId,
          })
        : this.queryExecutor.executeWithAgent(this.agent, {
            query: content,
            taskId,
          }))

      // Emit task:completed
      this.emit(TransportTaskEventNames.COMPLETED, {result, taskId})
    } catch (error) {
      // Emit task:error
      const errorData = serializeTaskError(error)
      this.emit(TransportTaskEventNames.ERROR, {error: errorData, taskId})
    } finally {
      cleanupForwarders()
    }
  }

  /**
   * Handle task:create request — fire execution asynchronously and return immediately.
   *
   * This matches SocketIOTransportClient behavior: request('task:create') resolves
   * with {taskId} right away, while execution runs in the background emitting events.
   * The use case registers on() handlers after request() returns, before events arrive.
   */
  private handleTaskCreate(data: Record<string, unknown>): unknown {
    const taskId = data.taskId as string

    // Fire execution asynchronously — do not await.
    // Errors are handled internally (emitted as task:error), so the promise never rejects.
    this.activeTask = this.executeTask(data)

    return {taskId}
  }

  /**
   * Forward agentEventBus events to registered transport-style handlers.
   * Returns a cleanup function to remove all forwarders.
   */
  private setupEventForwarding(taskId: string): () => void {
    const eventBus = this.agent.agentEventBus
    if (!eventBus) {
      return () => {}
    }

    const forwarders: Array<{event: string; handler: (data?: unknown) => void}> = []

    const forward = <T>(busEvent: string, transportEvent: string, transform?: (payload: T) => unknown): void => {
      const handler = (payload?: unknown): void => {
        const data = payload as T & {taskId?: string}
        if (data?.taskId === taskId) {
          this.emit(transportEvent, transform ? transform(data) : data)
        }
      }

      eventBus.on(busEvent, handler)
      forwarders.push({event: busEvent, handler})
    }

    forward<AgentEventMap['llmservice:toolCall']>('llmservice:toolCall', LlmEventNames.TOOL_CALL)

    forward<AgentEventMap['llmservice:toolResult']>('llmservice:toolResult', LlmEventNames.TOOL_RESULT)

    forward<AgentEventMap['llmservice:response']>('llmservice:response', LlmEventNames.RESPONSE)

    forward<AgentEventMap['llmservice:error']>('llmservice:error', LlmEventNames.ERROR)

    forward<AgentEventMap['llmservice:thinking']>('llmservice:thinking', LlmEventNames.THINKING)

    forward<AgentEventMap['llmservice:chunk']>('llmservice:chunk', LlmEventNames.CHUNK)

    forward<AgentEventMap['llmservice:unsupportedInput']>('llmservice:unsupportedInput', LlmEventNames.UNSUPPORTED_INPUT)

    return () => {
      for (const {event, handler} of forwarders) {
        eventBus.off(event, handler)
      }
    }
  }
}
