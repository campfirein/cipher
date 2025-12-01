/**
 * Shared types for LLM providers.
 * These types are common across all LLM provider implementations.
 */

/**
 * Tool definition for LLM function calling.
 * Describes a function that the LLM can call during execution.
 */
export type Tool = {
  /** Description of what the tool does */
  description: string
  /** The name of the tool/function */
  name: string
  /** JSON Schema defining the parameters */
  parameters: {
    properties: Record<string, unknown>
    required?: string[]
    type: 'object'
  }
}

/**
 * Executor function that implements the actual tool logic.
 * Called by the LLM provider when the model requests a tool execution.
 *
 * @param name - The name of the tool being executed
 * @param args - The arguments passed by the LLM
 * @returns The result as a string to be sent back to the LLM
 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>

/**
 * Base configuration shared by all LLM providers.
 */
export type BaseLlmConfig = {
  /** API key for authentication */
  apiKey: string
  /** Maximum iterations for agentic loops */
  maxIterations?: number
  /** Maximum tokens in the response */
  maxTokens?: number
  /** Model name/identifier */
  model?: string
  /** Temperature for randomness (0-1) */
  temperature?: number
  /** Request timeout in milliseconds */
  timeout?: number
}
