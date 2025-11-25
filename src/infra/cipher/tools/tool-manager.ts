import type {ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {IToolProvider} from '../../../core/interfaces/cipher/i-tool-provider.js'
import type {ToolMarker} from './tool-markers.js'

import {ToolError, ToolErrorType, ToolErrorUtils, type ToolExecutionResult} from '../../../core/domain/cipher/tools/tool-error.js'

/**
 * Tool Manager for memAgent
 *
 * Provides a clean interface for tool discovery and execution.
 * Wraps ToolProvider with caching for improved performance.
 *
 * Simplified version without:
 * - MCP integration (future)
 * - Approval/confirmation system (future)
 * - Plugin hooks (future)
 * - Event emission (future)
 * - Session management (future)
 */
export class ToolManager {
  private cacheValid: boolean = false
  private readonly toolProvider: IToolProvider
  private toolsCache: ToolSet = {}

  /**
   * Creates a new tool manager
   * @param toolProvider - Tool provider instance
   */
  public constructor(toolProvider: IToolProvider) {
    this.toolProvider = toolProvider
  }

  /**
   * Execute a tool by name with structured error handling.
   *
   * Returns a structured result that includes success status, content,
   * error classification, and metadata. This enables better error handling
   * and provides actionable feedback to the LLM.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments (validated by provider)
   * @returns Structured tool execution result
   */
  public async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = Date.now()

    try {
      // Check if tool exists before execution
      if (!this.hasTool(toolName)) {
        throw new ToolError(
          `Tool '${toolName}' not found`,
          ToolErrorType.TOOL_NOT_FOUND,
          toolName,
          {context: {availableTools: this.getToolNames()}}
        )
      }

      // Execute tool via provider
      const result = await this.toolProvider.executeTool(toolName, args)
      const durationMs = Date.now() - startTime

      // Return success result
      return ToolErrorUtils.createSuccess(result, { durationMs })
    } catch (error) {
      const durationMs = Date.now() - startTime

      // Classify error
      const toolError = ToolErrorUtils.classify(error, toolName)

      // Return error result
      return ToolErrorUtils.createErrorResult(toolError, { durationMs })
    }
  }

  /**
   * Get all available tools in JSON Schema format.
   * Results are cached for performance.
   *
   * @returns Tool set with JSON Schema definitions for LLM
   */
  public getAllTools(): ToolSet {
    // Return cached tools if valid
    if (this.cacheValid) {
      return this.toolsCache
    }

    // Rebuild cache
    this.toolsCache = this.toolProvider.getAllTools()
    this.cacheValid = true

    return this.toolsCache
  }

  /**
   * Get all available tool markers from registered tools.
   *
   * @returns Set of tool marker strings
   */
  public getAvailableMarkers(): Set<string> {
    return this.toolProvider.getAvailableMarkers()
  }

  /**
   * Get the count of registered tools.
   *
   * @returns Number of available tools
   */
  public getToolCount(): number {
    return this.toolProvider.getToolCount()
  }

  /**
   * Get names of all registered tools.
   *
   * @returns Array of tool names
   */
  public getToolNames(): string[] {
    return this.toolProvider.getToolNames()
  }

  /**
   * Get tool names that have a specific marker.
   *
   * @param marker - The tool marker to filter by
   * @returns Array of tool names with the specified marker
   */
  public getToolsByMarker(marker: ToolMarker): string[] {
    return this.toolProvider.getToolsByMarker(marker)
  }

  /**
   * Check if a tool exists.
   *
   * @param toolName - Name of the tool
   * @returns True if the tool exists
   */
  public hasTool(toolName: string): boolean {
    return this.toolProvider.hasTool(toolName)
  }

  /**
   * Initialize the tool manager.
   * Registers all available tools and invalidates cache.
   */
  public async initialize(): Promise<void> {
    await this.toolProvider.initialize()
    this.invalidateCache()
  }

  /**
   * Refresh tool discovery.
   * Invalidates the tool cache, forcing a rebuild on next getAllTools() call.
   *
   * Useful when:
   * - Adding/removing tools dynamically (future)
   * - MCP servers connect/disconnect (future)
   * - Manual cache clearing needed
   */
  public refresh(): void {
    this.invalidateCache()
  }

  /**
   * Invalidates the tool cache.
   * Next call to getAllTools() will rebuild the cache.
   */
  private invalidateCache(): void {
    this.cacheValid = false
    this.toolsCache = {}
  }
}
