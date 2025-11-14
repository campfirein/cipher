import type {ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {IToolProvider} from '../../../core/interfaces/cipher/i-tool-provider.js'

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
   * Execute a tool by name.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments (validated by provider)
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolValidationError if input validation fails
   * @throws ToolExecutionError if execution fails
   */
  public async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.toolProvider.executeTool(toolName, args)
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
