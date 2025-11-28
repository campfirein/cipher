import type {ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {IToolProvider} from '../../../core/interfaces/cipher/i-tool-provider.js'
import type {IToolScheduler} from '../../../core/interfaces/cipher/i-tool-scheduler.js'
import type {ToolMarker} from './tool-markers.js'

import {ToolError, ToolErrorType, ToolErrorUtils, type ToolExecutionResult} from '../../../core/domain/cipher/tools/tool-error.js'

/**
 * Tool Manager for CipherAgent
 *
 * Provides a clean interface for tool discovery and execution.
 * Wraps ToolProvider with caching for improved performance.
 *
 * Features:
 * - Optional scheduler integration for policy-based execution
 * - Tool caching for performance
 * - Structured error handling with classification
 *
 * When a scheduler is provided, tool execution flows through:
 * 1. Policy check (ALLOW/DENY)
 * 2. Execution (if allowed)
 *
 * Without a scheduler, tools execute directly via the provider.
 */
export class ToolManager {
  private cacheValid: boolean = false
  private readonly scheduler?: IToolScheduler
  private readonly toolProvider: IToolProvider
  private toolsCache: ToolSet = {}

  /**
   * Creates a new tool manager
   *
   * @param toolProvider - Tool provider instance
   * @param scheduler - Optional tool scheduler for policy-based execution
   */
  public constructor(toolProvider: IToolProvider, scheduler?: IToolScheduler) {
    this.toolProvider = toolProvider
    this.scheduler = scheduler
  }

  /**
   * Execute a tool by name with structured error handling.
   *
   * Returns a structured result that includes success status, content,
   * error classification, and metadata. This enables better error handling
   * and provides actionable feedback to the LLM.
   *
   * When a scheduler is configured, execution flows through:
   * 1. Policy check (ALLOW/DENY)
   * 2. Execution (if allowed)
   *
   * Without a scheduler, tools execute directly via the provider.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments (validated by provider)
   * @param sessionId - Optional session ID for context
   * @returns Structured tool execution result
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<ToolExecutionResult> {
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

      // Execute tool via scheduler (with policy check) or directly via provider
      const result = this.scheduler
        ? await this.scheduler.execute(toolName, args, {sessionId: sessionId ?? 'default'})
        : await this.toolProvider.executeTool(toolName, args, sessionId)

      const durationMs = Date.now() - startTime

      // Return success result
      return ToolErrorUtils.createSuccess(result, {durationMs})
    } catch (error) {
      const durationMs = Date.now() - startTime

      // Classify error
      const toolError = ToolErrorUtils.classify(error, toolName)

      // Return error result
      return ToolErrorUtils.createErrorResult(toolError, {durationMs})
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
