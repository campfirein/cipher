import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { Content } from '@google/genai'

import type { ToolExecutionResult } from '../../core/domain/tools/tool-error.js'
import type { ToolSet } from '../../core/domain/tools/types.js'
import type { ExecutionContext } from '../../core/interfaces/i-cipher-agent.js'
import type { IHistoryStorage } from '../../core/interfaces/i-history-storage.js'
import type { ILLMService } from '../../core/interfaces/i-llm-service.js'
import type { ILogger } from '../../core/interfaces/i-logger.js'
import type { IMessageFormatter } from '../../core/interfaces/i-message-formatter.js'
import type { ITokenizer } from '../../core/interfaces/i-tokenizer.js'
import type {
  InternalMessage,
  ToolCall,
  ToolStateCompleted,
  ToolStateError,
  ToolStateRunning,
} from '../../core/interfaces/message-types.js'
import type { MemoryManager } from '../memory/memory-manager.js'
import type { SystemPromptManager } from '../system-prompt/system-prompt-manager.js'
import type { ToolManager } from '../tools/tool-manager.js'
import type { CompactionService } from './context/compaction/compaction-service.js'

import { getErrorMessage } from '../../../server/utils/error-helpers.js'
import { AgentStateMachine } from '../../core/domain/agent/agent-state-machine.js'
import { AgentState, TerminationReason } from '../../core/domain/agent/agent-state.js'
import { LlmGenerationError, LlmMaxIterationsError, LlmResponseParsingError } from '../../core/domain/errors/llm-error.js'
import {
  getEffectiveMaxInputTokens,
  getMaxInputTokensForModel,
  getProviderFromModel,
  isValidProviderModel,
  safeParseLLMConfig,
} from '../../core/domain/llm/index.js'
import {
  type GenerateContentRequest,
  type IContentGenerator,
  StreamChunkType,
} from '../../core/interfaces/i-content-generator.js'
import { NoOpLogger } from '../../core/interfaces/i-logger.js'
import { EnvironmentContextBuilder } from '../environment/environment-context-builder.js'
import { SessionEventBus } from '../events/event-emitter.js'
import { ToolMetadataHandler } from '../tools/streaming/metadata-handler.js'
import { AsyncMutex } from './context/async-mutex.js'
import { ContextManager, type FileData, type ImageData } from './context/context-manager.js'
import { LoopDetector } from './context/loop-detector.js'
import { ClaudeMessageFormatter } from './formatters/claude-formatter.js'
import { GeminiMessageFormatter } from './formatters/gemini-formatter.js'
import { type ThinkingConfig, ThoughtParser } from './thought-parser.js'
import { ClaudeTokenizer } from './tokenizers/claude-tokenizer.js'
import { GeminiTokenizer } from './tokenizers/gemini-tokenizer.js'
import { type ProcessedOutput, ToolOutputProcessor, type TruncationConfig } from './tool-output-processor.js'

/** Target utilization ratio for message tokens (leaves headroom for response) */
const TARGET_MESSAGE_TOKEN_UTILIZATION = 0.7

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
 * Options for building generation request
 */
interface BuildGenerateContentRequestOptions {
  executionContext?: ExecutionContext
  systemPrompt: string
  taskId?: string
  tools: ToolSet
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
  private readonly compactionService?: CompactionService
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
  private readonly environmentBuilder: EnvironmentContextBuilder
  private readonly formatter: IMessageFormatter<Content | MessageParam>
  private readonly generator: IContentGenerator
  private readonly logger: ILogger
  private readonly loopDetector: LoopDetector
  private readonly memoryManager?: MemoryManager
  private readonly metadataHandler: ToolMetadataHandler
  private readonly mutex = new AsyncMutex()
  private readonly outputProcessor: ToolOutputProcessor
  private readonly providerType: 'claude' | 'gemini'
  private readonly sessionEventBus: SessionEventBus
  private readonly sessionId: string
  private readonly systemPromptManager: SystemPromptManager
  private readonly tokenizer: ITokenizer
  private readonly toolManager: ToolManager
  private readonly workingDirectory: string

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
   * @param options.systemPromptManager - System prompt manager for building system prompts
   * @param options.memoryManager - Memory manager for agent memories
   * @param options.sessionEventBus - Event bus for session lifecycle events
   * @param options.compactionService - Optional compaction service for context overflow management
   * @param options.historyStorage - Optional history storage for persistence
   * @param options.logger - Optional logger for structured logging
   */
  public constructor(
    sessionId: string,
    generator: IContentGenerator,
    config: ByteRoverLLMServiceConfig,
    options: {
      compactionService?: CompactionService
      historyStorage?: IHistoryStorage
      logger?: ILogger
      memoryManager?: MemoryManager
      sessionEventBus: SessionEventBus
      systemPromptManager: SystemPromptManager
      toolManager: ToolManager
    },
  ) {
    this.sessionId = sessionId
    this.generator = generator
    this.compactionService = options.compactionService
    this.toolManager = options.toolManager
    this.systemPromptManager = options.systemPromptManager
    this.memoryManager = options.memoryManager
    this.sessionEventBus = options.sessionEventBus
    this.logger = options.logger ?? new NoOpLogger()
    this.outputProcessor = new ToolOutputProcessor(config.truncationConfig)
    this.loopDetector = new LoopDetector()
    this.environmentBuilder = new EnvironmentContextBuilder()
    this.metadataHandler = new ToolMetadataHandler(this.sessionEventBus)
    this.workingDirectory = process.cwd()
    // Detect provider type from model name (needed for validation)
    const modelName = config.model ?? 'claude-haiku-4-5@20251001'
    this.providerType = this.detectProviderType(modelName)

    // Validate core LLM config using Zod schema (logs warning if invalid)
    this.validateConfig(modelName, config.maxInputTokens)

    // Get effective max input tokens from registry (respects model limits)
    const effectiveMaxInputTokens = getEffectiveMaxInputTokens(this.providerType, modelName, config.maxInputTokens)

    this.config = {
      maxInputTokens: effectiveMaxInputTokens,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: modelName,
      temperature: config.temperature ?? 0.7,
      thinkingConfig: config.thinkingConfig,
      timeout: config.timeout,
      verbose: config.verbose ?? false,
    }

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
   * @param options - Execution options
   * @param options.executionContext - Optional execution context
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream response (not implemented yet)
   * @param options.taskId - Task ID from usecase for billing tracking
   * @returns Final assistant response
   */
  public async completeTask(
    textInput: string,
    options?: {
      executionContext?: ExecutionContext
      fileData?: FileData
      imageData?: ImageData
      signal?: AbortSignal
      stream?: boolean
      taskId?: string
    },
  ): Promise<string> {
    // Extract options with defaults
    const { executionContext, fileData, imageData, signal, stream, taskId } = options ?? {}

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
        return this.handleTermination(terminationReason, stateMachine, taskId)
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
          fileData,
          imageData,
          iterationCount: stateMachine.getContext().turnCount,
          stream,
          taskId,
          textInput,
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
        this.handleLLMError(error, taskId)
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
    // Get model's actual max tokens from registry
    const modelMaxTokens = getMaxInputTokensForModel(this.providerType, this.config.model)

    return {
      configuredMaxInputTokens: this.config.maxInputTokens,
      model: this.config.model,
      modelMaxInputTokens: modelMaxTokens,
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
    const { toolCall, toolResult } = result

    if (!toolResult) {
      // This shouldn't happen, but handle gracefully
      await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, 'Error: No tool result available', {
        errorType: 'NO_RESULT',
        success: false,
      })
      return
    }

    await this.contextManager.addToolResult(
      toolCall.id,
      toolCall.function.name,
      toolResult.processedOutput.content,
      {
        errorType: toolResult.errorType,
        metadata: toolResult.metadata,
        success: toolResult.success,
      },
      toolResult.processedOutput.attachments,
    )
  }

  /**
   * Build generation request for the IContentGenerator.
   *
   * Converts internal context to the standardized GenerateContentRequest format.
   *
   * @param options - Request options
   * @param options.systemPrompt - System prompt text
   * @param options.tools - Available tools for function calling
   * @param options.executionContext - Optional execution context
   * @returns GenerateContentRequest for the generator
   */
  private buildGenerateContentRequest(options: BuildGenerateContentRequestOptions): GenerateContentRequest {
    // Get internal messages from context manager
    const messages = this.contextManager.getMessages()

    return {
      config: {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
      contents: messages,
      executionContext: options.executionContext,
      model: this.config.model,
      systemPrompt: options.systemPrompt,
      taskId: options.taskId ?? '',
      tools: options.tools,
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
   * Streaming variant of callLLMAndParseResponse that:
   * - Uses generateContentStream for real-time chunk delivery
   * - Accumulates content and tool calls from chunks
   * - Emits llmservice:chunk events for thinking/reasoning chunks
   * - Returns complete InternalMessage when stream ends
   *
   * @param request - Generation request
   * @param taskId - Task ID for event emission
   * @returns Parsed internal message from accumulated stream
   */
  private async callLLMAndParseResponseStreaming(
    request: GenerateContentRequest,
    taskId?: string,
  ): Promise<InternalMessage> {
    try {
      let accumulatedContent = ''
      let accumulatedToolCalls: ToolCall[] = []

      // Stream chunks and accumulate content
      for await (const chunk of this.generator.generateContentStream(request)) {
        // Emit thinking/reasoning chunks as events for TUI display
        if (chunk.type === StreamChunkType.THINKING && chunk.reasoning) {
          this.sessionEventBus.emit('llmservice:chunk', {
            content: chunk.reasoning,
            isComplete: chunk.isComplete,
            taskId,
            type: 'reasoning', // Convert THINKING to 'reasoning' for TUI compatibility
          })
        }

        // Accumulate text content (skip thinking chunks from accumulated content)
        if (chunk.content && chunk.type !== StreamChunkType.THINKING) {
          accumulatedContent += chunk.content

          // Emit text chunks for TUI display
          this.sessionEventBus.emit('llmservice:chunk', {
            content: chunk.content,
            isComplete: chunk.isComplete,
            taskId,
            type: 'text',
          })
        }

        // Accumulate tool calls
        if (chunk.toolCalls) {
          accumulatedToolCalls = chunk.toolCalls
        }
      }

      // Convert accumulated response to InternalMessage format
      const message: InternalMessage = {
        content: accumulatedContent || null,
        role: 'assistant',
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
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
   * Check for context overflow and trigger compaction if needed.
   * Called after each assistant response and after tool execution batches.
   *
   * Follows OpenCode's compaction patterns:
   * - First tries pruning tool outputs (if overflow > 85%)
   * - Then tries full compaction with LLM summary (if overflow > 95%)
   *
   * @param taskId - Task ID from usecase for billing tracking (passed from caller)
   */
  private async checkAndTriggerCompaction(taskId: string): Promise<void> {
    if (!this.compactionService) return

    // Calculate current token usage
    const messages = this.contextManager.getMessages()
    const messagesTokens = messages.reduce(
      (total, msg) =>
        total +
        this.generator.estimateTokensSync(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)),
      0,
    )

    // Estimate system prompt tokens (rough estimate since we don't have full context here)
    // Using a conservative estimate of 2000 tokens for system prompt
    const estimatedSystemPromptTokens = 2000
    const currentTokens = estimatedSystemPromptTokens + messagesTokens

    // Check overflow
    const overflowResult = this.compactionService.checkOverflow(currentTokens, this.config.maxInputTokens)

    if (!overflowResult.isOverflow) return

    // Emit context overflow event
    const utilizationPercent = Math.round((currentTokens / this.config.maxInputTokens) * 100)
    this.sessionEventBus.emit('llmservice:contextOverflow', {
      currentTokens,
      maxTokens: this.config.maxInputTokens,
      taskId: taskId || undefined,
      utilizationPercent,
    })

    if (overflowResult.recommendation === 'prune') {
      // Try pruning tool outputs first
      const pruneResult = await this.compactionService.pruneToolOutputs(this.sessionId)

      if (this.config.verbose && pruneResult.compactedCount > 0) {
        console.log(
          `[Compaction] Pruned ${pruneResult.compactedCount} tool outputs, saved ~${pruneResult.tokensSaved} tokens`,
        )
      }

      // Emit context pruned event
      if (pruneResult.compactedCount > 0) {
        this.sessionEventBus.emit('llmservice:contextPruned', {
          pruneCount: pruneResult.compactedCount,
          reason: 'overflow',
          taskId: taskId || undefined,
          tokensSaved: pruneResult.tokensSaved,
        })

        // Also emit warning for backward compatibility
        this.sessionEventBus.emit('llmservice:warning', {
          message: `Context compaction: pruned ${pruneResult.compactedCount} old tool outputs (~${pruneResult.tokensSaved} tokens)`,
          taskId: taskId || undefined,
        })
      }
    } else if (overflowResult.recommendation === 'compact') {
      const originalTokens = currentTokens

      // Full compaction needed - generate LLM summary
      // Use the same taskId from caller for billing tracking
      const summary = await this.compactionService.generateSummary(this.generator, messages, taskId, this.config.model)

      await this.compactionService.createCompactionBoundary(this.sessionId, summary)

      if (this.config.verbose) {
        console.log('[Compaction] Created compaction boundary with LLM-generated summary')
      }

      // Emit context compressed event
      // Estimate compressed tokens (summary is much smaller than original)
      const compressedTokens = this.generator.estimateTokensSync(summary)
      this.sessionEventBus.emit('llmservice:contextCompressed', {
        compressedTokens,
        originalTokens,
        strategy: 'summary',
        taskId: taskId || undefined,
      })

      // Also emit warning for backward compatibility
      this.sessionEventBus.emit('llmservice:warning', {
        message: 'Context compaction: created summary boundary for conversation history',
        taskId: taskId || undefined,
      })
    }
  }

  /**
   * Detect provider type from model name using the LLM registry.
   *
   * Uses the centralized registry to determine provider from model name.
   * Falls back to string prefix matching if model is not in registry.
   *
   * @param model - Model identifier
   * @returns Provider type ('claude' or 'gemini')
   */
  private detectProviderType(model: string): 'claude' | 'gemini' {
    // Use registry to detect provider
    const registryProvider = getProviderFromModel(model)
    if (registryProvider === 'claude' || registryProvider === 'gemini') {
      return registryProvider
    }

    // Fallback to string prefix matching for unknown models
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
   * @returns Reflection type to add, or undefined if none eligible
   */
  private determineReflectionType(
    iterationCount: number,
    commandType?: 'chat' | 'curate' | 'query',
  ): 'completion_check' | 'final_iteration' | 'mid_point_check' | 'near_max_iterations' | undefined {
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

    return undefined
  }

  /**
   * Execute a single iteration of the agentic loop.
   *
   * @param options - Iteration options
   * @param options.executionContext - Optional execution context
   * @param options.fileData - Optional file data (only used on first iteration)
   * @param options.imageData - Optional image data (only used on first iteration)
   * @param options.iterationCount - Current iteration number
   * @param options.stream - Whether to stream response and emit thinking chunks
   * @param options.taskId - Task ID from usecase for billing tracking
   * @param options.textInput - User input text (only used on first iteration)
   * @param options.tools - Available tools for this iteration
   * @returns Final response string if complete, null if more iterations needed
   */
  private async executeAgenticIteration(options: {
    executionContext?: ExecutionContext
    fileData?: FileData
    imageData?: ImageData
    iterationCount: number
    stream?: boolean
    taskId?: string
    textInput: string
    tools: ToolSet
  }): Promise<null | string> {
    const { executionContext, fileData, imageData, iterationCount, stream, taskId, textInput, tools } = options
    // Build system prompt using SystemPromptManager (before compression for correct token accounting)
    // Use filtered tool names based on command type (e.g., only read-only tools for 'query')
    const availableTools = this.toolManager.getToolNamesForCommand(executionContext?.commandType)
    const markersSet = this.toolManager.getAvailableMarkers()
    // Convert Set to Record for prompt factory
    const availableMarkers: Record<string, string> = {}
    for (const marker of markersSet) {
      availableMarkers[marker] = marker
    }

    // Build environment context for system prompt
    const environmentContext = await this.environmentBuilder.build({
      includeBrvStructure: true,
      includeFileTree: true,
      maxFileTreeDepth: 3,
      maxFileTreeEntries: 100,
      workingDirectory: this.workingDirectory,
    })

    let systemPrompt = await this.systemPromptManager.build({
      availableMarkers,
      availableTools,
      commandType: executionContext?.commandType,
      conversationMetadata: executionContext?.conversationMetadata,
      environmentContext,
      fileReferenceInstructions: executionContext?.fileReferenceInstructions,
      memoryManager: this.memoryManager,
    })

    // Determine which reflection prompt to add (only highest priority is chosen)
    const reflectionType = this.determineReflectionType(iterationCount, executionContext?.commandType)

    // Add reflection prompt if eligible (hierarchical: only one reflection per iteration)
    if (reflectionType) {
      const reflectionPrompt = this.systemPromptManager.buildReflectionPrompt({
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

    // Final iteration optimization for query: strip tools (reflection already added above)
    let toolsForThisIteration = tools
    if (executionContext?.commandType === 'query' && iterationCount === this.config.maxIterations - 1) {
      toolsForThisIteration = {} // Empty toolset forces text response
    }

    // Get token count for logging (using system prompt for token accounting)
    const systemPromptTokens = this.generator.estimateTokensSync(systemPrompt)

    // Add user message and compress context within mutex lock
    return this.mutex.withLock(async () => {
      // Add user message to context only on the first iteration
      if (iterationCount === 0) {
        await this.contextManager.addUserMessage(textInput, imageData, fileData)
      }

      const messages = this.contextManager.getMessages()
      const messageTokenCounts = messages.map((msg) =>
        this.generator.estimateTokensSync(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)),
      )

      const maxMessageTokens = this.config.maxInputTokens - systemPromptTokens
      // Target utilization to leave headroom for response
      const targetMessageTokens = Math.floor(maxMessageTokens * TARGET_MESSAGE_TOKEN_UTILIZATION)

      this.contextManager.compressMessage(targetMessageTokens, messageTokenCounts)

      // Calculate tokens after compression
      const compressedMessagesTokens = this.contextManager
        .getMessages()
        .reduce(
          (total, msg) =>
            total +
            this.generator.estimateTokensSync(
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            ),
          0,
        )
      const tokensUsed = systemPromptTokens + compressedMessagesTokens

      // Verbose: Log messages that will be sent to LLM
      if (this.config.verbose) {
        console.log('\n========== MESSAGES (Sent to LLM) ==========')
        console.log(JSON.stringify(this.contextManager.getMessages(), null, 2))
        console.log('========== END MESSAGES ==========\n')
        // Log token usage for monitoring compression behavior
        console.log(
          `[ByteRoverLLMService] [Iter ${iterationCount + 1}/${this.config.maxIterations
          }] Sending to LLM: ${tokensUsed} tokens (max: ${this.config.maxInputTokens})`,
        )
      }

      // Build generation request
      const request = this.buildGenerateContentRequest({
        executionContext,
        systemPrompt,
        taskId,
        tools: toolsForThisIteration,
      })

      // Call LLM via generator (retry + logging handled by decorators)
      // Use streaming variant if enabled to emit thinking/reasoning chunks
      const lastMessage = stream
        ? await this.callLLMAndParseResponseStreaming(request, taskId)
        : await this.callLLMAndParseResponse(request)

      // Check if there are tool calls
      if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
        const response = await this.handleFinalResponse(lastMessage, taskId)

        // Auto-compaction check after assistant response
        await this.checkAndTriggerCompaction(taskId ?? '')

        return response
      }

      // Has tool calls - handle them (pass taskId for subagent billing)
      await this.handleToolCalls(lastMessage, taskId)

      // Auto-compaction check after tool execution batch
      await this.checkAndTriggerCompaction(taskId ?? '')

      return null
    })
  }

  /**
   * Execute a single tool call in parallel (without adding to context).
   * Returns all information needed to add the result to context later.
   *
   * @param toolCall - Tool call to execute
   * @param taskId - Task ID from usecase for billing tracking (passed to subagents)
   * @returns Parallel tool result with all execution data
   */
  private async executeToolCallParallel(toolCall: ToolCall, taskId?: string): Promise<ParallelToolResult> {
    const toolName = toolCall.function.name
    const toolArgs = JSON.parse(toolCall.function.arguments)

    try {
      // Check for loops before execution (mutex-protected)
      const loopResult = await this.loopDetector.recordAndCheck(toolName, toolArgs)

      if (loopResult.isLoop) {
        // Emit dedicated doom loop event for observability
        this.sessionEventBus.emit('llmservice:doomLoopDetected', {
          args: toolArgs,
          loopType: loopResult.loopType!,
          repeatCount: loopResult.repeatCount ?? 0,
          taskId: taskId || undefined,
          toolName,
        })

        // Also emit warning event for backward compatibility
        this.sessionEventBus.emit('llmservice:warning', {
          message: `Doom loop detected: ${loopResult.loopType} - tool "${toolName}" repeated ${loopResult.repeatCount} times. Auto-denying to prevent infinite loop.`,
          taskId: taskId || undefined,
        })

        return {
          toolCall,
          toolResult: {
            errorType: 'LOOP_DETECTED',
            metadata: {
              loopType: loopResult.loopType,
              repeatCount: loopResult.repeatCount,
            },
            processedOutput: {
              content: `⚠️ DOOM LOOP DETECTED: ${loopResult.suggestion}\n\nThe tool call has been automatically rejected to prevent an infinite loop. Please try a different approach to accomplish your goal.`,
            },
            success: false,
          },
        }
      }

      // Emit tool call event
      this.sessionEventBus.emit('llmservice:toolCall', {
        args: toolArgs,
        callId: toolCall.id,
        taskId: taskId || undefined,
        toolName,
      })

      // Create metadata callback for streaming tool output
      const metadataCallback = this.metadataHandler.createCallback(toolCall.id, toolName)

      // Execute tool via ToolManager (returns structured result)
      // Pass taskId in context for subagent billing tracking
      const result: ToolExecutionResult = await this.toolManager.executeTool(toolName, toolArgs, this.sessionId, {
        metadata: metadataCallback,
        taskId,
      })

      // Process output (truncation and file saving if needed)
      const processedOutput = await this.outputProcessor.processStructuredOutput(toolName, result.content)

      // Emit truncation event if output was truncated
      if (processedOutput.metadata?.truncated) {
        this.sessionEventBus.emit('llmservice:outputTruncated', {
          originalLength: processedOutput.metadata.originalLength!,
          savedToFile: processedOutput.metadata.savedToFile!,
          taskId: taskId || undefined,
          toolName,
        })
      }

      // Emit tool result event with success/error info
      this.sessionEventBus.emit('llmservice:toolResult', {
        callId: toolCall.id,
        error: result.errorMessage,
        errorType: result.errorType,
        metadata: {
          ...result.metadata,
          ...processedOutput.metadata,
        },
        result: processedOutput.content,
        success: result.success,
        taskId: taskId || undefined,
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
      this.logger.error('Error executing tool in parallel', { error, toolCallId: toolCall.id, toolName })

      return {
        error: errorMessage,
        toolCall,
        toolResult: {
          errorType: 'EXECUTION_ERROR',
          metadata: {},
          processedOutput: { content: `Error executing tool: ${errorMessage}` },
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
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Final response content
   */
  private async handleFinalResponse(lastMessage: InternalMessage, taskId?: string): Promise<string> {
    const content = this.extractTextContent(lastMessage)

    // Emit response event
    this.sessionEventBus.emit('llmservice:response', {
      content,
      model: this.config.model,
      provider: 'byterover',
      taskId: taskId || undefined,
    })

    // Add assistant message to context
    await this.contextManager.addAssistantMessage(content)

    return content
  }

  /**
   * Handle LLM errors and re-throw or wrap appropriately.
   *
   * @param error - Error to handle
   * @param taskId - Optional task ID for concurrent task isolation
   */
  private handleLLMError(error: unknown, taskId?: string): never {
    // Emit error event
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.sessionEventBus.emit('llmservice:error', {
      error: errorMessage,
      taskId: taskId || undefined,
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
   * @param taskId - Optional task ID for concurrent task isolation
   * @returns Partial response or fallback message
   */
  private async handleTermination(
    reason: TerminationReason,
    stateMachine: AgentStateMachine,
    taskId?: string,
  ): Promise<string> {
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
      taskId: taskId || undefined,
    })

    // Get accumulated response from context
    const partialResponse = await this.getPartialResponse()

    this.sessionEventBus.emit('llmservice:response', {
      content: partialResponse,
      model: this.config.model,
      partial: true,
      provider: 'byterover',
      taskId: taskId || undefined,
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
   * @param taskId - Optional task ID for concurrent task isolation
   */
  private handleThoughts(message: InternalMessage, taskId?: string): void {
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
        taskId: taskId || undefined,
      })
    }
  }

  /**
   * Handle tool calls from LLM response.
   * Uses tool parts with state machine: pending → running → completed/error.
   * Executes tools in parallel for performance, but updates state in order.
   *
   * @param lastMessage - Last message containing tool calls
   * @param taskId - Task ID from usecase for billing tracking (passed to subagents)
   */
  private async handleToolCalls(lastMessage: InternalMessage, taskId?: string): Promise<void> {
    if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    // Emit thought events if present
    this.handleThoughts(lastMessage, taskId)

    // Has tool calls - add assistant message with tool calls
    const assistantContent = this.extractTextContent(lastMessage)
    await this.contextManager.addAssistantMessage(assistantContent, lastMessage.toolCalls)

    // Step 1: Create pending tool parts for all tool calls
    for (const toolCall of lastMessage.toolCalls) {
      const toolArgs = JSON.parse(toolCall.function.arguments)
      this.contextManager.addToolCallPending(toolCall.id, toolCall.function.name, toolArgs)
    }

    // Step 2: Transition all to running state
    const startTime = Date.now()
    for (const toolCall of lastMessage.toolCalls) {
      const runningState: ToolStateRunning = {
        input: JSON.parse(toolCall.function.arguments),
        startedAt: startTime,
        status: 'running',
      }
      this.contextManager.updateToolCallState(toolCall.id, runningState)
    }

    // Step 3: Execute all tool calls in parallel (pass taskId for subagent billing)
    const parallelResults = await Promise.allSettled(
      lastMessage.toolCalls.map((toolCall) => this.executeToolCallParallel(toolCall, taskId)),
    )

    // Step 4: Update tool part states with results (in order)
    const endTime = Date.now()
    // eslint-disable-next-line unicorn/no-for-loop -- Need index to access both parallelResults and toolCalls in parallel
    for (let i = 0; i < parallelResults.length; i++) {
      const settledResult = parallelResults[i]
      const toolCall = lastMessage.toolCalls[i]
      const toolArgs = JSON.parse(toolCall.function.arguments)

      if (settledResult.status === 'fulfilled') {
        const result = settledResult.value

        if (result.toolResult?.success) {
          // Transition to completed state
          const completedState: ToolStateCompleted = {
            attachments: result.toolResult.processedOutput.attachments,
            input: toolArgs,
            metadata: result.toolResult.metadata,
            output: result.toolResult.processedOutput.content,
            status: 'completed',
            time: { end: endTime, start: startTime },
            title: result.toolResult.processedOutput.title,
          }
          this.contextManager.updateToolCallState(toolCall.id, completedState)
        } else {
          // Transition to error state
          const errorState: ToolStateError = {
            error: result.toolResult?.processedOutput.content ?? result.error ?? 'Unknown error',
            input: toolArgs,
            status: 'error',
            time: { end: endTime, start: startTime },
          }
          this.contextManager.updateToolCallState(toolCall.id, errorState)
        }

        // Also add to context as tool result message (for backward compatibility)
        // eslint-disable-next-line no-await-in-loop -- Must add results in order
        await this.addParallelToolResultToContext(result)
      } else {
        // Handle unexpected Promise rejection
        const errorMessage = getErrorMessage(settledResult.reason)
        this.logger.error('Unexpected error in parallel tool execution', {
          error: settledResult.reason,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
        })

        // Transition to error state
        const errorState: ToolStateError = {
          error: errorMessage,
          input: toolArgs,
          status: 'error',
          time: { end: endTime, start: startTime },
        }
        this.contextManager.updateToolCallState(toolCall.id, errorState)

        // Also add to context as tool result message (for backward compatibility)
        // eslint-disable-next-line no-await-in-loop -- Must add results in order
        await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, `Error: ${errorMessage}`, {
          errorType: 'UNEXPECTED_ERROR',
          success: false,
        })
      }
    }
  }

  /**
   * Validate LLM configuration using Zod schema.
   *
   * Performs validation against the centralized LLM config schema.
   * Logs warnings for invalid configurations but doesn't throw to maintain
   * backward compatibility with existing code.
   *
   * @param model - Model name to validate
   * @param maxInputTokens - Optional max input tokens to validate
   */
  private validateConfig(model: string, maxInputTokens?: number): void {
    const result = safeParseLLMConfig({
      maxInputTokens,
      maxIterations: this.config?.maxIterations ?? 50,
      model,
      provider: this.providerType,
    })

    if (!result.success) {
      // Log validation warnings but don't throw (backward compatibility)
      const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')

      this.logger.warn('LLM config validation warning', {
        issues,
        model,
        provider: this.providerType,
      })

      // Also check if model is valid in registry
      if (!isValidProviderModel(this.providerType, model)) {
        this.logger.info('Model not in registry, using fallback defaults', {
          model,
          provider: this.providerType,
        })
      }
    }
  }
}
