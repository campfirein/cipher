import type { ToolExecutionContext, ToolSet } from '../../core/domain/tools/types.js'
import type { ToolHookContext } from '../../core/interfaces/i-tool-plugin.js'
import type { IToolProvider } from '../../core/interfaces/i-tool-provider.js'
import type { IToolScheduler } from '../../core/interfaces/i-tool-scheduler.js'
import type { ToolPluginManager } from './plugins/plugin-manager.js'
import type { ToolMarker } from './tool-markers.js'

import { getAgentRegistry } from '../../core/domain/agent/agent-registry.js'
import { ToolError, ToolErrorType, ToolErrorUtils, type ToolExecutionResult } from '../../core/domain/tools/tool-error.js'

/**
 * Tool Manager for CipherAgent
 *
 * Provides a clean interface for tool discovery and execution.
 * Wraps ToolProvider with caching for improved performance.
 *
 * Features:
 * - Optional scheduler integration for policy-based execution
 * - Optional plugin system for before/after execution hooks
 * - Tool caching for performance
 * - Structured error handling with classification
 *
 * When a scheduler is provided, tool execution flows through:
 * 1. Policy check (ALLOW/DENY)
 * 2. Execution (if allowed)
 *
 * When a plugin manager is provided, execution flows through:
 * 1. Before hooks (can modify args or block execution)
 * 2. Tool execution
 * 3. After hooks (for logging, auditing, etc.)
 *
 * Without a scheduler, tools execute directly via the provider.
 */
export class ToolManager {
  /**
   * Tools allowed for curate operations.
   * Uses code_exec only - curate operations available via tools.curate() in sandbox.
   */
  private static readonly CURATE_TOOL_NAMES = [
    'agentic_map',
    'code_exec',
    'llm_map',
  ] as const
  /**
   * Tools allowed for query operations - only code_exec for programmatic search
   * All search operations (searchKnowledge, glob, grep, readFile) are available
   * via tools.* SDK inside the sandbox
   */
  private static readonly QUERY_TOOL_NAMES = [
    'code_exec',
  ] as const
  private cacheValid: boolean = false
  private callIdCounter: number = 0
  private readonly pluginManager?: ToolPluginManager
  private readonly scheduler?: IToolScheduler
  private readonly toolProvider: IToolProvider
  private toolsCache: ToolSet = {}

  /**
   * Creates a new tool manager
   *
   * @param toolProvider - Tool provider instance
   * @param scheduler - Optional tool scheduler for policy-based execution
   * @param pluginManager - Optional plugin manager for before/after hooks
   */
  public constructor(
    toolProvider: IToolProvider,
    scheduler?: IToolScheduler,
    pluginManager?: ToolPluginManager,
  ) {
    this.toolProvider = toolProvider
    this.scheduler = scheduler
    this.pluginManager = pluginManager
  }

  /**
   * Execute a tool by name with structured error handling.
   *
   * Returns a structured result that includes success status, content,
   * error classification, and metadata. This enables better error handling
   * and provides actionable feedback to the LLM.
   *
   * When a plugin manager is configured, execution flows through:
   * 1. Before hooks (can modify args or block execution)
   * 2. Tool execution (via scheduler or provider)
   * 3. After hooks (for logging, auditing, etc.)
   *
   * When a scheduler is configured, tool execution flows through:
   * 1. Policy check (ALLOW/DENY)
   * 2. Execution (if allowed)
   *
   * Without a scheduler, tools execute directly via the provider.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments (validated by provider)
   * @param sessionId - Optional session ID for context
   * @param context - Optional execution context (includes metadata callback for streaming)
   * @returns Structured tool execution result
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    const callId = this.generateCallId()
    const hookContext: ToolHookContext = {
      callId,
      sessionId: sessionId ?? 'default',
      toolName,
    }

    // Merge sessionId into context if not already present
    const effectiveContext: ToolExecutionContext = {
      ...context,
      sessionId: context?.sessionId ?? sessionId,
    }

    try {
      // Check if tool exists before execution
      if (!this.hasTool(toolName)) {
        throw new ToolError(
          `Tool '${toolName}' not found`,
          ToolErrorType.TOOL_NOT_FOUND,
          toolName,
          { context: { availableTools: this.getToolNames() } }
        )
      }

      // Run before hooks (can modify args or block execution)
      let effectiveArgs = args
      if (this.pluginManager) {
        const beforeResult = await this.pluginManager.triggerBefore(hookContext, args)
        if (!beforeResult.proceed) {
          const errorResult = ToolErrorUtils.createErrorResult(
            new ToolError(
              beforeResult.reason ?? 'Execution blocked by plugin',
              ToolErrorType.PERMISSION_DENIED,
              toolName
            ),
            { durationMs: Date.now() - startTime }
          )
          await this.pluginManager.triggerAfter(hookContext, args, errorResult)

          return errorResult
        }

        effectiveArgs = beforeResult.args
      }

      // Execute tool via scheduler (with policy check) or directly via provider
      const result = this.scheduler
        ? await this.scheduler.execute(toolName, effectiveArgs, {
          sessionId: sessionId ?? 'default',
          taskId: effectiveContext.taskId,
        })
        : await this.toolProvider.executeTool(toolName, effectiveArgs, sessionId, effectiveContext)

      const durationMs = Date.now() - startTime

      // Create success result
      const successResult = ToolErrorUtils.createSuccess(result, { durationMs })

      // Run after hooks
      if (this.pluginManager) {
        await this.pluginManager.triggerAfter(hookContext, effectiveArgs, successResult)
      }

      return successResult
    } catch (error) {
      const durationMs = Date.now() - startTime

      // Classify error
      const toolError = ToolErrorUtils.classify(error, toolName)

      // Create error result
      const errorResult = ToolErrorUtils.createErrorResult(toolError, { durationMs })

      // Run after hooks even on error
      if (this.pluginManager) {
        await this.pluginManager.triggerAfter(hookContext, args, errorResult)
      }

      return errorResult
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
   * Get filtered tool names based on command type.
   * For 'query' command, returns only read-only discovery tools.
   * For 'curate' command, returns only curate-specific tools.
   * For other commands, returns all tools.
   *
   * @param commandType - The command type ('curate', 'query', etc.)
   * @returns Array of filtered tool names
   */
  public getToolNamesForCommand(commandType?: string): string[] {
    if (commandType === 'query') {
      // For query: only allow read-only tools
      return [...ToolManager.QUERY_TOOL_NAMES].filter((name) => this.hasTool(name))
    }

    if (commandType === 'curate') {
      // For curate: only allow curate tools
      return [...ToolManager.CURATE_TOOL_NAMES].filter((name) => this.hasTool(name))
    }

    // For all other commands: return all tools
    return this.getToolNames()
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
   * Get filtered tools based on agent configuration.
   * Uses the agent registry to determine which tools are enabled/disabled for the agent.
   *
   * Tool filtering rules from agent.tools config:
   * - `{ '*': false }` - Disable all tools
   * - `{ '*': false, 'tool_name': true }` - Only enable specific tools
   * - `{ 'tool_name': false }` - Disable specific tools, keep others enabled
   * - `{}` or undefined - All tools enabled (default)
   *
   * @param agentName - The agent name (e.g., 'plan', 'query', 'curate')
   * @returns Filtered tool set based on agent configuration
   */
  public getToolsForAgent(agentName: string): ToolSet {
    const registry = getAgentRegistry()
    const agent = registry.get(agentName)

    if (!agent) {
      // Unknown agent - return all tools
      return this.getAllTools()
    }

    const allTools = this.getAllTools()
    const toolConfig = agent.tools

    // If no tool config or empty, return all tools
    if (!toolConfig || Object.keys(toolConfig).length === 0) {
      return allTools
    }

    // Check for wildcard disable
    const wildcardValue = toolConfig['*']

    const filteredTools: ToolSet = {}

    for (const [toolName, toolDef] of Object.entries(allTools)) {
      // Get specific config for this tool, or use wildcard, or default to true
      const isEnabled = toolConfig[toolName] ?? wildcardValue ?? true

      if (isEnabled) {
        filteredTools[toolName] = toolDef
      }
    }

    return filteredTools
  }

  /**
   * Get filtered tools based on command type.
   * For 'query' command, returns only read-only discovery tools.
   * For 'curate' command, returns only curate-specific tools.
   * For other commands, returns all tools.
   *
   * @param commandType - The command type ('curate', 'query', etc.)
   * @returns Filtered tool set with JSON Schema definitions
   */
  public getToolsForCommand(commandType?: string): ToolSet {
    const allTools = this.getAllTools()

    if (commandType === 'query') {
      // For query: only allow read-only tools
      const filteredTools: ToolSet = {}
      for (const toolName of ToolManager.QUERY_TOOL_NAMES) {
        if (allTools[toolName]) {
          filteredTools[toolName] = allTools[toolName]
        }
      }

      return filteredTools
    }

    if (commandType === 'curate') {
      // For curate: only allow curate tools
      const filteredTools: ToolSet = {}
      for (const toolName of ToolManager.CURATE_TOOL_NAMES) {
        if (allTools[toolName]) {
          filteredTools[toolName] = allTools[toolName]
        }
      }

      return filteredTools
    }

    // For all other commands: return all tools
    return allTools
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
   * Generates a unique call ID for tool execution.
   */
  private generateCallId(): string {
    this.callIdCounter++

    return `call_${Date.now()}_${this.callIdCounter}`
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