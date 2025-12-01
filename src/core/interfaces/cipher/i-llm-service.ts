import type {ContextManager, FileData, ImageData} from '../../../infra/cipher/llm/context/context-manager.js'
import type {LLMServiceConfig} from '../../../infra/cipher/llm/internal-llm-service.js'
import type {ToolSet} from '../../domain/cipher/tools/types.js'
import type {ExecutionContext} from './i-cipher-agent.js'

/**
 * LLM Service interface.
 *
 * Defines the contract for LLM service implementations.
 * Services handle the agentic loop, tool calling, and context management.
 *
 * Based on dexto's ILLMService pattern.
 */
export interface ILLMService {
  /**
   * Complete a task with agentic tool calling support.
   *
   * Main entry point for executing user requests with tool support.
   * The service handles:
   * - Adding user message to context
   * - Agentic loop (LLM → tool calls → LLM)
   * - Returning final response
   *
   * @param textInput - User input text
   * @param sessionId - Session ID for tracking the conversation
   * @param options - Execution options
   * @param options.signal - Optional abort signal for cancellation
   * @param options.imageData - Optional image data
   * @param options.fileData - Optional file data
   * @param options.stream - Whether to stream the response (optional)
   * @param options.executionContext - Optional execution context (for autonomous mode, etc.)
   * @param options.mode - Optional mode for system prompt ('autonomous' enables autonomous mode)
   * @returns Final assistant response
   */
  completeTask(
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
  ): Promise<string>

  /**
   * Get all available tools.
   *
   * @returns Tool set with JSON Schema definitions
   */
  getAllTools(): Promise<ToolSet>

  /**
   * Get service configuration.
   *
   * @returns Service configuration including model, provider, token limits
   */
  getConfig(): LLMServiceConfig

  /**
   * Get the context manager instance.
   *
   * Allows access to conversation history and context management.
   *
   * @returns Context manager instance
   */
  getContextManager(): ContextManager<unknown>
}
