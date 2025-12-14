import type {ToolMarker} from '../../../infra/cipher/tools/tool-markers.js'
import type {ToolExecutionContext, ToolSet} from '../../domain/cipher/tools/types.js'

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
   * @param context - Optional execution context (includes metadata callback for streaming)
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolValidationError if input validation fails
   * @throws ToolExecutionError if execution fails
   */
  executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    context?: ToolExecutionContext,
  ): Promise<unknown>

  /**
   * Get all registered tools in JSON Schema format.
   * Used to expose tools to the LLM.
   *
   * @returns Tool set with JSON Schema definitions
   */
  getAllTools(): ToolSet

  /**
   * Get all available tool markers from registered tools.
   *
   * @returns Set of tool marker strings
   */
  getAvailableMarkers(): Set<string>

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
   * Get tool names that have a specific marker.
   *
   * @param marker - The tool marker to filter by
   * @returns Array of tool names with the specified marker
   */
  getToolsByMarker(marker: ToolMarker): string[]

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
