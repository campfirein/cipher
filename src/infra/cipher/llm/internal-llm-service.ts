import type {MessageParam} from '@anthropic-ai/sdk/resources/messages'
import type {Content} from '@google/genai'

import type {ToolExecutionResult} from '../../../core/domain/cipher/tools/tool-error.js'
import type {ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {ExecutionContext} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {GenerateContentRequest, IContentGenerator} from '../../../core/interfaces/cipher/i-content-generator.js'
import type {IHistoryStorage} from '../../../core/interfaces/cipher/i-history-storage.js'
import type {ILLMService} from '../../../core/interfaces/cipher/i-llm-service.js'
import type {ILogger} from '../../../core/interfaces/cipher/i-logger.js'
import type {IMessageFormatter} from '../../../core/interfaces/cipher/i-message-formatter.js'
import type {ITokenizer} from '../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage, ToolCall} from '../../../core/interfaces/cipher/message-types.js'
import type {MemoryManager} from '../memory/memory-manager.js'
import type {SimplePromptFactory} from '../system-prompt/simple-prompt-factory.js'
import type {ToolManager} from '../tools/tool-manager.js'

import {AgentStateMachine} from '../../../core/domain/cipher/agent/agent-state-machine.js'
import {AgentState, TerminationReason} from '../../../core/domain/cipher/agent/agent-state.js'
import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmResponseParsingError,
} from '../../../core/domain/cipher/errors/llm-error.js'
import {NoOpLogger} from '../../../core/interfaces/cipher/i-logger.js'
import {getErrorMessage} from '../../../utils/error-helpers.js'
import {SessionEventBus} from '../events/event-emitter.js'
import {ContextManager, type FileData, type ImageData} from './context/context-manager.js'
import {LoopDetector} from './context/loop-detector.js'
import {ClaudeMessageFormatter} from './formatters/claude-formatter.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'
import {type ThinkingConfig, ThoughtParser} from './thought-parser.js'
import {ClaudeTokenizer} from './tokenizers/claude-tokenizer.js'
import {GeminiTokenizer} from './tokenizers/gemini-tokenizer.js'
import {type ProcessedOutput, ToolOutputProcessor, type TruncationConfig} from './tool-output-processor.js'

/**
 * Result of parallel tool execution (before adding to context).
 * Contains all information needed to add the result to context in order.
 */
interface ParallelToolResult {
  /** Error message if tool execution failed */
  error?: string
  /** Original tool call for reference */
  toolCall: ToolCall
  /** Tool result data (only present if success) */
  toolResult?: {
    errorType?: string
    metadata: Record<string, unknown>
    processedOutput: ProcessedOutput
    success: boolean
  }
}

/**
 * Configuration for ByteRover LLM service
 */
export interface ByteRoverLLMServiceConfig {
  maxInputTokens?: number
  maxIterations?: number
  maxTokens?: number
  model: string
  temperature?: number
  /**
   * Thinking configuration for Gemini models (optional).
   * If not provided, will be auto-configured based on model version.
   */
  thinkingConfig?: ThinkingConfig
  timeout?: number
  /**
   * Truncation configuration for tool outputs (optional).
   * If not provided, will use default truncation settings.
   */
  truncationConfig?: TruncationConfig
  verbose?: boolean
}

/**
 * LLM service configuration response
 */
export interface LLMServiceConfig {
  configuredMaxInputTokens: number
  model: string
  modelMaxInputTokens: number
  provider: string
  router: string
}

/**
 * ByteRover LLM Service.
 *
 * Orchestrates the agentic loop using IContentGenerator for LLM calls.
 * Responsibilities:
 * - Manage conversation context via ContextManager
 * - Execute agentic loop (call LLM → execute tools → repeat)
 * - Delegate tool execution to ToolManager
 * - Delegate LLM calls to IContentGenerator
 * - Handle errors and iteration limits
 *
 * Does NOT:
 * - Execute tools directly (uses ToolManager)
 * - Store persistent history (uses in-memory ContextManager)
 * - Format messages for specific providers (handled by generators)
 * - Handle retry logic (handled by RetryableContentGenerator decorator)
 */
export class ByteRoverLLMService implements ILLMService {
  private readonly config: {
    maxInputTokens: number
    maxIterations: number
    maxTokens: number
    model: string
    temperature: number
    thinkingConfig?: ThinkingConfig
    timeout?: number
    verbose: boolean
  }
  private readonly contextManager: ContextManager<Content | MessageParam>
  private readonly formatter: IMessageFormatter<Content | MessageParam>
  private readonly generator: IContentGenerator
  private readonly logger: ILogger
  private readonly loopDetector: LoopDetector
  private readonly memoryManager?: MemoryManager
  private readonly outputProcessor: ToolOutputProcessor
  private readonly promptFactory: SimplePromptFactory
  private readonly providerType: 'claude' | 'gemini'
  private readonly sessionEventBus: SessionEventBus
  private readonly tokenizer: ITokenizer
  private readonly toolManager: ToolManager

  /**
   * Initialize a new ByteRover LLM service instance.
   *
   * Sets up the service with all required dependencies and initializes:
   * - Context manager for conversation history
   * - Message formatter (Gemini or Claude format based on model)
   * - Token counter/tokenizer for the selected model
   * - Configuration with sensible defaults
   *
   * Each service instance maintains isolated conversation context,
   * allowing multiple concurrent sessions with separate histories.
   *
   * @param sessionId - Unique identifier for this session
   * @param generator - Content generator for LLM calls (with decorators pre-applied)
   * @param config - LLM service configuration (model, tokens, temperature)
   * @param options - Service dependencies
   * @param options.toolManager - Tool manager for executing agent tools
   * @param options.promptFactory - Simple prompt factory for building system prompts
   * @param options.memoryManager - Memory manager for agent memories
   * @param options.sessionEventBus - Event bus for session lifecycle events
   * @param options.historyStorage - Optional history storage for persistence
   * @param options.logger - Optional logger for structured logging
   */
  public constructor(
    sessionId: string,
    generator: IContentGenerator,
    config: ByteRoverLLMServiceConfig,
    options: {
      historyStorage?: IHistoryStorage
      logger?: ILogger
      memoryManager?: MemoryManager
      promptFactory: SimplePromptFactory
      sessionEventBus: SessionEventBus
      toolManager: ToolManager
    },
  ) {
    this.generator = generator
    this.toolManager = options.toolManager
    this.promptFactory = options.promptFactory
    this.memoryManager = options.memoryManager
    this.sessionEventBus = options.sessionEventBus
    this.logger = options.logger ?? new NoOpLogger()
    this.outputProcessor = new ToolOutputProcessor(config.truncationConfig)
    this.loopDetector = new LoopDetector()
    this.config = {
      maxInputTokens: config.maxInputTokens ?? 1_000_000,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'claude-haiku-4-5@20251001',
      temperature: config.temperature ?? 0.7,
      thinkingConfig: config.thinkingConfig,
      timeout: config.timeout,
      verbose: config.verbose ?? false,
    }

    // Detect provider type from model name
    this.providerType = this.detectProviderType(this.config.model)

    // Initialize formatter and tokenizer based on provider type
    if (this.providerType === 'claude') {
      this.formatter = new ClaudeMessageFormatter()
      this.tokenizer = new ClaudeTokenizer(this.config.model)
    } else {
      this.formatter = new GeminiMessageFormatter()
      this.tokenizer = new GeminiTokenizer(this.config.model)
    }

    // Initialize context manager with optional history storage
    this.contextManager = new ContextManager({
      formatter: this.formatter,
      historyStorage: options.historyStorage,
      maxInputTokens: this.config.maxInputTokens,
      sessionId,
      tokenizer: this.tokenizer,
    })
  }

  /**
   * Complete a task with tool calling support.
   *
   * This is the main entry point for the agentic loop.
   * It handles:
   * 1. Adding user message to context
   * 2. Looping: call LLM → check for tool calls → execute tools
   * 3. Returning final response when no more tool calls
   *
   * @param textInput - User input text
   * @param sessionId - Session ID for tracking the llm request in a command session
   * @param options - Execution options
   * @param options.executionContext - Optional execution context
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream response (not implemented yet)
   * @param options.mode - Optional mode for system prompt ('autonomous' enables autonomous mode)
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    sessionId: string,
    options?: {
      executionContext?: ExecutionContext
      fileData?: FileData
      imageData?: ImageData
      mode?: 'autonomous' | 'default' | 'query'
      signal?: AbortSignal
      stream?: boolean
    },
  ): Promise<string> {
    // Extract options with defaults
    const {executionContext, fileData, imageData, mode, signal} = options ?? {}

    // Add user message to context
    await this.contextManager.addUserMessage(textInput, imageData, fileData)

    // Get filtered tools based on command type (e.g., only read-only tools for 'query')
    const toolSet = this.toolManager.getToolsForCommand(options?.executionContext?.commandType)

    // Create state machine with configured limits
    const maxTimeMs = this.config.timeout ?? 600_000 // 10 min default
    const stateMachine = new AgentStateMachine(this.config.maxIterations, maxTimeMs)
    stateMachine.transition(AgentState.EXECUTING)

    // Agentic loop with state machine
    while (!stateMachine.isTerminal()) {
      // Check termination conditions (timeout, max turns)
      const terminationReason = stateMachine.shouldTerminate()
      if (terminationReason) {
        return this.handleTermination(terminationReason, stateMachine)
      }

      // Check if aborted via signal
      if (signal?.aborted) {
        stateMachine.abort()
        throw new Error('Operation aborted')
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- Sequential iterations required for agentic loop
        const result = await this.executeAgenticIteration({
          executionContext,
          iterationCount: stateMachine.getContext().turnCount,
          mode,
          sessionId,
          tools: toolSet,
        })

        if (result !== null) {
          // Task complete - no tool calls
          stateMachine.complete()
          return result
        }

        // Tool calls were executed, continue loop
        stateMachine.incrementTurn()
      } catch (error) {
        stateMachine.fail(error as Error)
        this.handleLLMError(error)
      }
    }

    // Should not reach here - state machine should exit via terminal states
    throw new Error('Agent loop terminated unexpectedly')
  }

  /**
   * Get all available tools for the agent.
   *
   * Retrieves the current set of tools that can be used during task execution.
   * These tools are passed to the LLM to enable function calling capabilities.
   *
   * @returns Promise resolving to a map of tool names to their schemas
   */
  public async getAllTools(): Promise<ToolSet> {
    return this.toolManager.getAllTools()
  }

  /**
   * Get the service's runtime configuration.
   *
   * Returns metadata about the service including:
   * - Configured and model-specific token limits
   * - Selected LLM model
   * - Provider name (always 'byterover')
   * - Router type (always 'in-built')
   *
   * This is useful for introspecting service capabilities and limits
   * without needing access to the internal config object.
   *
   * @returns Service configuration object with model info and constraints
   */
  public getConfig(): LLMServiceConfig {
    return {
      configuredMaxInputTokens: this.config.maxInputTokens,
      model: this.config.model,
      modelMaxInputTokens: this.config.maxInputTokens,
      provider: 'byterover',
      router: 'in-built',
    }
  }

  /**
   * Get access to the conversation context manager.
   *
   * Provides access to the ContextManager instance that maintains:
   * - Conversation history (messages and responses)
   * - Token counting and compression
   * - Message formatting for the selected model
   *
   * Useful for:
   * - Inspecting conversation state
   * - Retrieving formatted messages
   * - Managing context during multi-turn interactions
   *
   * @returns The ContextManager instance managing conversation state
   */
  public getContextManager(): ContextManager<unknown> {
    return this.contextManager
  }

  /**
   * Initialize the LLM service by loading persisted history.
   * Should be called after construction to restore previous conversation.
   *
   * @returns True if history was loaded, false otherwise
   */
  public async initialize(): Promise<boolean> {
    return this.contextManager.initialize()
  }

  /**
   * Add a parallel tool result to the context.
   * Called sequentially after parallel execution to preserve message order.
   *
   * @param result - Parallel tool result to add
   */
  private async addParallelToolResultToContext(result: ParallelToolResult): Promise<void> {
    const {toolCall, toolResult} = result

    if (!toolResult) {
      // This shouldn't happen, but handle gracefully
      await this.contextManager.addToolResult(
        toolCall.id,
        toolCall.function.name,
        'Error: No tool result available',
        {errorType: 'NO_RESULT', success: false},
      )
      return
    }

    await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, toolResult.processedOutput.content, {
      errorType: toolResult.errorType,
      metadata: toolResult.metadata,
      success: toolResult.success,
    })
  }

  /**
   * Build generation request for the IContentGenerator.
   *
   * Converts internal context to the standardized GenerateContentRequest format.
   *
   * @param sessionId - Session ID for tracking the llm request in a command session
   * @param systemPrompt - System prompt text
   * @param tools - Available tools for function calling
   * @param mode - Optional mode for system prompt
   * @param executionContext - Optional execution context
   * @returns GenerateContentRequest for the generator
   */
  private buildGenerateContentRequest(
    sessionId: string,
    systemPrompt: string,
    tools: ToolSet,
    mode?: 'autonomous' | 'default' | 'query',
    executionContext?: ExecutionContext,
  ): GenerateContentRequest {
    // Get internal messages from context manager
    const messages = this.contextManager.getMessages()

    return {
      config: {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
      contents: messages,
      executionContext,
      mode,
      model: this.config.model,
      sessionId,
      systemPrompt,
      tools,
    }
  }

  /**
   * Call LLM via generator and process the response.
   *
   * Uses the IContentGenerator interface which already has:
   * - Retry logic (via RetryableContentGenerator decorator)
   * - Logging (via LoggingContentGenerator decorator)
   *
   * @param request - Generation request
   * @returns Parsed internal message from response
   */
  private async callLLMAndParseResponse(request: GenerateContentRequest): Promise<InternalMessage> {
    try {
      const response = await this.generator.generateContent(request)

      // Convert response to InternalMessage format
      const message: InternalMessage = {
        content: response.content,
        role: 'assistant',
        toolCalls: response.toolCalls,
      }

      // Validate the message has content or tool calls
      if (!message.content && (!message.toolCalls || message.toolCalls.length === 0)) {
        throw new LlmResponseParsingError('Response has neither content nor tool calls', 'byterover', this.config.model)
      }

      return message
    } catch (error) {
      // Re-throw LLM errors as-is
      if (error instanceof LlmResponseParsingError || error instanceof LlmGenerationError) {
        throw error
      }

      // Wrap other errors
      throw new LlmGenerationError(
        error instanceof Error ? error.message : String(error),
        'byterover',
        this.config.model,
      )
    }
  }

  /**
   * Detect provider type from model name.
   *
   * @param model - Model identifier
   * @returns Provider type ('claude' or 'gemini')
   */
  private detectProviderType(model: string): 'claude' | 'gemini' {
    return model.toLowerCase().startsWith('claude') ? 'claude' : 'gemini'
  }

  /**
   * Determine which reflection prompt to add based on hierarchical priority.
   * Only the highest priority eligible reflection is returned.
   *
   * Priority (highest to lowest):
   * 1. final_iteration - query only, at the last iteration
   * 2. near_max_iterations - general, at 80% threshold
   * 3. mid_point_check - query only, at 50% threshold
   * 4. completion_check - general, periodic every 3 iterations
   *
   * @param iterationCount - Current iteration count (0-indexed)
   * @param commandType - Command type ('query' or 'curate')
   * @returns Reflection type to add, or null if none eligible
   */
  private determineReflectionType(
    iterationCount: number,
    commandType?: 'curate' | 'query',
  ): 'completion_check' | 'final_iteration' | 'mid_point_check' | 'near_max_iterations' | null {
    const isQuery = commandType === 'query'
    const isLastIteration = iterationCount === this.config.maxIterations - 1
    const midPoint = Math.floor(this.config.maxIterations / 2)
    const isAtMidPoint = iterationCount === midPoint
    const isNearMax = iterationCount >= Math.floor(this.config.maxIterations * 0.8)
    const isPeriodicCheck = iterationCount > 0 && iterationCount % 3 === 0

    // Priority 1: final_iteration (query only, last iteration) - highest priority
    if (isQuery && isLastIteration) {
      return 'final_iteration'
    }

    // Priority 2: near_max_iterations (general, 80% threshold)
    if (isNearMax) {
      return 'near_max_iterations'
    }

    // Priority 3: mid_point_check (query only, 50% threshold)
    if (isQuery && isAtMidPoint) {
      return 'mid_point_check'
    }

    // Priority 4: completion_check (general, periodic every 3 iterations) - lowest priority
    if (isPeriodicCheck) {
      return 'completion_check'
    }

    return null
  }

  /**
   * Execute a single iteration of the agentic loop.
   *
   * @param options - Iteration options
   * @param options.iterationCount - Current iteration number
   * @param options.sessionId - Session ID for tracking the llm request in a command session
   * @param options.tools - Available tools for this iteration
   * @param options.mode - Optional mode for system prompt
   * @param options.executionContext - Optional execution context
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(options: {
    executionContext?: ExecutionContext
    iterationCount: number
    mode?: 'autonomous' | 'default' | 'query'
    sessionId: string
    tools: ToolSet
  }): Promise<null | string> {
    const {executionContext, iterationCount, mode, sessionId, tools} = options
    // Build system prompt using SimplePromptFactory (before compression for correct token accounting)
    // Use filtered tool names based on command type (e.g., only read-only tools for 'query')
    const availableTools = this.toolManager.getToolNamesForCommand(executionContext?.commandType)
    const markersSet = this.toolManager.getAvailableMarkers()
    // Convert Set to Record for prompt factory
    const availableMarkers: Record<string, string> = {}
    for (const marker of markersSet) {
      availableMarkers[marker] = marker
    }

    let systemPrompt = await this.promptFactory.buildSystemPrompt({
      availableMarkers,
      availableTools,
      commandType: executionContext?.commandType,
      conversationMetadata: executionContext?.conversationMetadata,
      memoryManager: this.memoryManager,
      mode,
    })

    // Determine which reflection prompt to add (only highest priority is chosen)
    const reflectionType = this.determineReflectionType(iterationCount, executionContext?.commandType)

    // Add reflection prompt if eligible (hierarchical: only one reflection per iteration)
    if (reflectionType) {
      const reflectionPrompt = this.promptFactory.buildReflectionPrompt({
        currentIteration: iterationCount + 1,
        maxIterations: this.config.maxIterations,
        type: reflectionType,
      })
      systemPrompt = systemPrompt + '\n\n' + reflectionPrompt
    }

    // Verbose debug: Show complete system prompt
    if (this.config.verbose) {
      this.logger.debug('System prompt details', {
        first500Chars: systemPrompt.slice(0, 500),
        iteration: iterationCount + 1,
        last500Chars: systemPrompt.slice(-500),
        length: systemPrompt.length,
        lines: systemPrompt.split('\n').length,
        reflectionType,
      })
    }

    // Get token count for logging (using system prompt for token accounting)
    const systemPromptTokens = this.generator.estimateTokensSync(systemPrompt)
    const messagesTokens = this.contextManager
      .getMessages()
      .reduce(
        (total, msg) =>
          total +
          this.generator.estimateTokensSync(
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          ),
        0,
      )
    const tokensUsed = systemPromptTokens + messagesTokens

    // Verbose: Log messages that will be sent to LLM
    if (this.config.verbose) {
      console.log('\n========== MESSAGES (Sent to LLM) ==========')
      console.log(JSON.stringify(this.contextManager.getMessages(), null, 2))
      console.log('========== END MESSAGES ==========\n')
      // Log token usage for monitoring compression behavior
      console.log(
        `[ByteRoverLLMService] [Iter ${iterationCount + 1}/${
          this.config.maxIterations
        }] Sending to LLM: ${tokensUsed} tokens (max: ${this.config.maxInputTokens})`,
      )
    }

    // Final iteration optimization for query: strip tools (reflection already added above)
    let toolsForThisIteration = tools
    if (executionContext?.commandType === 'query' && iterationCount === this.config.maxIterations - 1) {
      toolsForThisIteration = {} // Empty toolset forces text response
    }

    // Build generation request
    const request = this.buildGenerateContentRequest(sessionId, systemPrompt, toolsForThisIteration, mode, executionContext)

    // Call LLM via generator (retry + logging handled by decorators)
    const lastMessage = await this.callLLMAndParseResponse(request)

    // Check if there are tool calls
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return this.handleFinalResponse(lastMessage)
    }

    // Has tool calls - handle them
    await this.handleToolCalls(lastMessage)

    return null
  }

  /**
   * Execute a single tool call in parallel (without adding to context).
   * Returns all information needed to add the result to context later.
   *
   * @param toolCall - Tool call to execute
   * @returns Parallel tool result with all execution data
   */
  private async executeToolCallParallel(toolCall: ToolCall): Promise<ParallelToolResult> {
    const toolName = toolCall.function.name
    const toolArgs = JSON.parse(toolCall.function.arguments)

    try {
      // Check for loops before execution (mutex-protected)
      const loopResult = await this.loopDetector.recordAndCheck(toolName, toolArgs)

      if (loopResult.isLoop) {
        // Emit warning event
        this.sessionEventBus.emit('llmservice:warning', {
          message: `Loop detected: ${loopResult.loopType} - tool "${toolName}" repeated ${loopResult.repeatCount} times`,
        })

        return {
          toolCall,
          toolResult: {
            errorType: 'LOOP_DETECTED',
            metadata: {},
            processedOutput: {
              content: `⚠️ LOOP DETECTED: ${loopResult.suggestion}\n\nPlease try a different approach to accomplish your goal.`,
            },
            success: false,
          },
        }
      }

      // Emit tool call event
      this.sessionEventBus.emit('llmservice:toolCall', {
        args: toolArgs,
        callId: toolCall.id,
        toolName,
      })

      // Execute tool via ToolManager (returns structured result)
      const result: ToolExecutionResult = await this.toolManager.executeTool(toolName, toolArgs)

      // Process output (truncation and file saving if needed)
      const processedOutput = await this.outputProcessor.processOutput(toolName, result.content)

      // Emit truncation event if output was truncated
      if (processedOutput.metadata?.truncated) {
        this.sessionEventBus.emit('llmservice:outputTruncated', {
          originalLength: processedOutput.metadata.originalLength!,
          savedToFile: processedOutput.metadata.savedToFile!,
          toolName,
        })
      }

      // Emit tool result event with success/error info
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        errorType: result.errorType,
        metadata: {
          ...result.metadata,
          ...processedOutput.metadata,
        },
        result: processedOutput.content,
        success: result.success,
        toolName,
      })

      return {
        toolCall,
        toolResult: {
          errorType: result.errorType,
          metadata: {
            ...result.metadata,
            ...processedOutput.metadata,
          },
          processedOutput,
          success: result.success,
        },
      }
    } catch (error) {
      // Catch any unexpected errors during execution
      const errorMessage = getErrorMessage(error)
      this.logger.error('Error executing tool in parallel', {error, toolCallId: toolCall.id, toolName})

      return {
        error: errorMessage,
        toolCall,
        toolResult: {
          errorType: 'EXECUTION_ERROR',
          metadata: {},
          processedOutput: {content: `Error executing tool: ${errorMessage}`},
          success: false,
        },
      }
    }
  }

  /**
   * Extract text content from an internal message.
   *
   * @param message - Internal message
   * @returns Text content as string
   */
  private extractTextContent(message: InternalMessage): string {
    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => part.type === 'text')
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
    }

    return ''
  }

  /**
   * Extract partial response from conversation history when max iterations reached.
   * Returns the last assistant message or accumulated tool outputs.
   *
   * @returns Partial response string
   */
  private async getPartialResponse(): Promise<string> {
    const history = this.contextManager.getMessages()

    // Find last assistant message
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]
      if (msg && msg.role === 'assistant') {
        return this.extractTextContent(msg)
      }
    }

    return ''
  }

  /**
   * Handle final response when there are no tool calls.
   *
   * @param lastMessage - Last message from LLM
   * @returns Final response content
   */
  private async handleFinalResponse(lastMessage: InternalMessage): Promise<string> {
    const content = this.extractTextContent(lastMessage)

    // Emit response event
    this.sessionEventBus.emit('llmservice:response', {
      content,
      model: this.config.model,
      provider: 'byterover',
    })

    // Add assistant message to context
    await this.contextManager.addAssistantMessage(content)

    return content
  }

  /**
   * Handle LLM errors and re-throw or wrap appropriately.
   *
   * @param error - Error to handle
   */
  private handleLLMError(error: unknown): never {
    // Emit error event
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.sessionEventBus.emit('llmservice:error', {
      error: errorMessage,
    })

    // Re-throw LLM errors as-is
    if (
      error instanceof LlmResponseParsingError ||
      error instanceof LlmGenerationError ||
      error instanceof LlmMaxIterationsError
    ) {
      throw error
    }

    // Wrap other errors
    if (error && typeof error === 'object' && 'message' in error) {
      throw new LlmGenerationError(getErrorMessage(error), 'byterover', this.config.model)
    }

    throw new LlmGenerationError(String(error), 'byterover', this.config.model)
  }

  /**
   * Handle agent termination due to timeout or max turns.
   *
   * Emits appropriate events and returns a partial response.
   *
   * @param reason - Why the agent is terminating
   * @param stateMachine - The state machine for context
   * @returns Partial response or fallback message
   */
  private async handleTermination(reason: TerminationReason, stateMachine: AgentStateMachine): Promise<string> {
    const context = stateMachine.getContext()
    const durationMs = Date.now() - context.startTime.getTime()

    this.logger.warn('Agent execution terminated', {
      durationMs,
      reason,
      toolCallsExecuted: context.toolCallsExecuted,
      turnCount: context.turnCount,
    })

    // Emit termination event
    this.sessionEventBus.emit('llmservice:warning', {
      message: `Agent terminated: ${reason} after ${context.turnCount} turns`,
      model: this.config.model,
      provider: 'byterover',
    })

    // Get accumulated response from context
    const partialResponse = await this.getPartialResponse()

    this.sessionEventBus.emit('llmservice:response', {
      content: partialResponse,
      model: this.config.model,
      partial: true,
      provider: 'byterover',
    })

    if (reason === TerminationReason.MAX_TURNS) {
      return (
        partialResponse ||
        'Maximum iterations reached without completing the task. Please try breaking down the task into smaller steps.'
      )
    }

    if (reason === TerminationReason.TIMEOUT) {
      return partialResponse || 'Execution timed out. Please try a simpler task or increase the timeout.'
    }

    return partialResponse || 'Agent execution terminated unexpectedly.'
  }

  /**
   * Handle thoughts from LLM response (Gemini only).
   *
   * Extracts and emits thought events if present.
   *
   * @param message - Message potentially containing thoughts
   */
  private handleThoughts(message: InternalMessage): void {
    // Only process thoughts for Gemini models
    if (this.providerType !== 'gemini') {
      return
    }

    // Check if message has thought content
    if (message.thought) {
      // Parse thought if not already parsed
      if (!message.thoughtSummary) {
        message.thoughtSummary = ThoughtParser.parse(message.thought)
      }

      // Emit thought event
      this.sessionEventBus.emit('llmservice:thought', {
        description: message.thoughtSummary.description,
        subject: message.thoughtSummary.subject,
      })
    }
  }

  /**
   * Handle tool calls from LLM response.
   * Executes tools in parallel for performance, but adds results to context in order.
   *
   * @param lastMessage - Last message containing tool calls
   */
  private async handleToolCalls(lastMessage: InternalMessage): Promise<void> {
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    // Emit thought events if present
    this.handleThoughts(lastMessage)

    // Has tool calls - add assistant message with tool calls
    const assistantContent = this.extractTextContent(lastMessage)
    await this.contextManager.addAssistantMessage(assistantContent, lastMessage.toolCalls)

    // Execute all tool calls in parallel
    const parallelResults = await Promise.allSettled(
      lastMessage.toolCalls.map((toolCall) => this.executeToolCallParallel(toolCall)),
    )

    // Add results to context IN ORDER (preserves conversation flow)
    // eslint-disable-next-line unicorn/no-for-loop -- Need index to access both parallelResults and toolCalls in parallel
    for (let i = 0; i < parallelResults.length; i++) {
      const settledResult = parallelResults[i]
      const toolCall = lastMessage.toolCalls[i]

      if (settledResult.status === 'fulfilled') {
        const result = settledResult.value
        // eslint-disable-next-line no-await-in-loop -- Must add results in order
        await this.addParallelToolResultToContext(result)
      } else {
        // Handle unexpected Promise rejection (should be rare since executeToolCallParallel catches errors)
        const errorMessage = getErrorMessage(settledResult.reason)
        this.logger.error('Unexpected error in parallel tool execution', {
          error: settledResult.reason,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
        })
        // eslint-disable-next-line no-await-in-loop -- Must add results in order
        await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, `Error: ${errorMessage}`, {
          errorType: 'UNEXPECTED_ERROR',
          success: false,
        })
      }
    }
  }
}
