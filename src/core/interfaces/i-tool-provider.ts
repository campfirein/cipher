import type {ToolSet} from '../domain/tools/types.js'

/**
 * Interface for tool provider.
 * Manages tool registration, validation, and execution.
 */
export interface IToolProvider {
  /**
   * Execute a tool with the given arguments.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments (will be validated against schema)
   * @param sessionId - Optional session ID for context
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolValidationError if input validation fails
   * @throws ToolExecutionError if execution fails
   */
  executeTool(toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<unknown>

  /**
   * Get all registered tools in JSON Schema format.
   * Used to expose tools to the LLM.
   *
   * @returns Tool set with JSON Schema definitions
   */
  getAllTools(): ToolSet

  /**
   * Get the count of registered tools.
   *
   * @returns Number of registered tools
   */
  getToolCount(): number

  /**
   * Get names of all registered tools.
   *
   * @returns Array of tool names
   */
  getToolNames(): string[]

  /**
   * Check if a tool exists.
   *
   * @param toolName - Name of the tool
   * @returns True if the tool exists
   */
  hasTool(toolName: string): boolean

  /**
   * Initialize the tool provider.
   * Registers all available tools based on available services.
   */
  initialize(): Promise<void>
}
