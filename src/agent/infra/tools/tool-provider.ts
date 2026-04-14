import { ZodError } from 'zod'

import type { Tool, ToolExecutionContext, ToolSet } from '../../core/domain/tools/types.js'
import type { IToolProvider } from '../../core/interfaces/i-tool-provider.js'
import type { SystemPromptManager } from '../system-prompt/system-prompt-manager.js'
import type { ToolDescriptionLoader } from './tool-description-loader.js'
import type { ToolServices } from './tool-registry.js'

import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolProviderNotInitializedError,
  ToolValidationError,
} from '../../core/domain/errors/tool-error.js'
import {ToolInvocationBuilder} from './tool-invocation.js'
import { ToolMarker } from './tool-markers.js'
import { TOOL_REGISTRY } from './tool-registry.js'
import { convertZodToJsonSchema } from './utils/schema-converter.js'

/**
 * Tool provider implementation.
 * Manages tool lifecycle: registration, validation, and execution.
 *
 * Uses builder/invocation pattern for two-phase tool execution:
 * 1. Validation phase (via builder)
 * 2. Execution phase (via invocation)
 */
export class ToolProvider implements IToolProvider {
  /**
   * Known keys of ToolServices — used for runtime validation of Record<string, unknown> input.
   * Derived from ToolServices type to prevent drift.
   * TypeScript ensures this object matches ToolServices keys at compile time.
   */
  private static readonly VALID_SERVICE_KEYS = new Set<string>(
    Object.keys({
      abstractQueue: 0,
      agentInstance: 0,
      contentGenerator: 0,
      environmentContext: 0,
      fileSystemService: 0,
      getToolProvider: 0,
      logger: 0,
      maxContextTokens: 0,
      memoryManager: 0,
      memoryStore: 0,
      processService: 0,
      sandboxService: 0,
      todoStorage: 0,
      tokenizer: 0,
    } satisfies Record<keyof ToolServices, 0>),
  )
  private readonly descriptionLoader?: ToolDescriptionLoader
  private initialized: boolean = false
  private invocationBuilder?: ToolInvocationBuilder
  private services: ToolServices
  private readonly systemPromptManager?: SystemPromptManager
  private readonly toolMarkers: Set<string> = new Set()
private readonly tools: Map<string, Tool> = new Map()

  /**
   * Creates a new tool provider
   * @param services - Services available to tools
   * @param systemPromptManager - Optional system prompt manager for tool output guidance
   * @param descriptionLoader - Optional loader for external tool descriptions
   */
  public constructor(
    services: ToolServices,
    systemPromptManager?: SystemPromptManager,
    descriptionLoader?: ToolDescriptionLoader,
  ) {
    this.services = services
    this.systemPromptManager = systemPromptManager
    this.descriptionLoader = descriptionLoader
  }

  /**
   * Execute a tool with the given arguments using builder/invocation pattern.
   *
   * Two-phase execution:
   * 1. Build Phase: Validate and create invocation
   * 2. Execute Phase: Run the validated invocation
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments
   * @param sessionId - Optional session ID for context
   * @param context - Optional execution context (includes metadata callback for streaming)
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolValidationError if input validation fails
   * @throws ToolExecutionError if execution fails
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    this.ensureInitialized()

    if (!this.invocationBuilder) {
      throw new ToolProviderNotInitializedError()
    }

    try {
      // Phase 1: Build and validate invocation
      // Merge sessionId into context for backward compatibility
      const effectiveContext: ToolExecutionContext = {
        ...context,
        sessionId: context?.sessionId ?? sessionId,
      }
      const invocation = this.invocationBuilder.build(
        `tool_call_${Date.now()}`, // Generate unique ID
        toolName,
        args,
        effectiveContext
      )

      // Phase 2: Execute validated invocation
      const executionResult = await invocation.execute()

      // Handle execution result
      if (!executionResult.result) {
        // Execution failed
        if (executionResult.error) {
          throw new ToolExecutionError(
            toolName,
            executionResult.error.message,
            sessionId
          )
        }

        throw new ToolExecutionError(toolName, 'Unknown execution error', sessionId)
      }

      // Check if this tool has output guidance configured
      const registryEntry = TOOL_REGISTRY[toolName as keyof typeof TOOL_REGISTRY]
      if (registryEntry?.outputGuidance && this.systemPromptManager) {
        const guidance = this.systemPromptManager.getToolOutputGuidance(registryEntry.outputGuidance)

        if (guidance) {
          // Return structured result with guidance
          return {
            guidance,
            result: executionResult.result,
          }
        }
      }

      // Return result without guidance
      return executionResult.result
    } catch (error) {
      // Handle validation errors from builder
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join('; ')
        throw new ToolValidationError(toolName, errorMessages)
      }

      // Re-throw known errors
      if (
        error instanceof ToolNotFoundError ||
        error instanceof ToolValidationError ||
        error instanceof ToolExecutionError
      ) {
        throw error
      }

      // Handle other execution errors
      if (error instanceof Error) {
        throw new ToolExecutionError(toolName, error.message, sessionId)
      }

      // Unknown error type
      throw new ToolExecutionError(toolName, String(error), sessionId)
    }
  }

  /**
   * Get all registered tools in JSON Schema format.
   */
  public getAllTools(): ToolSet {
    this.ensureInitialized()

    const toolSet: ToolSet = {}

    for (const [toolName, tool] of this.tools.entries()) {
      toolSet[toolName] = {
        description: tool.description,
        name: toolName,
        parameters: convertZodToJsonSchema(tool.inputSchema),
      }
    }

    return toolSet
  }

  /**
   * Get all available tool markers from registered tools.
   */
  public getAvailableMarkers(): Set<string> {
    this.ensureInitialized()
    return new Set(this.toolMarkers)
  }

  /**
   * Get the count of registered tools.
   */
  public getToolCount(): number {
    this.ensureInitialized()
    return this.tools.size
  }

  /**
   * Get names of all registered tools.
   */
  public getToolNames(): string[] {
    this.ensureInitialized()
    return [...this.tools.keys()]
  }

  /**
   * Get tool names that have a specific marker.
   */
  public getToolsByMarker(marker: ToolMarker): string[] {
    this.ensureInitialized()

    const toolNames: string[] = []

    for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
      if (entry.markers.includes(marker) && this.tools.has(toolName)) {
        toolNames.push(toolName)
      }
    }

    return toolNames
  }

  /**
   * Check if a tool exists.
   */
  public hasTool(toolName: string): boolean {
    this.ensureInitialized()
    return this.tools.has(toolName)
  }

  /**
   * Initialize the tool provider.
   * Registers all tools whose required services are available.
   * If a description loader is provided, tool descriptions are loaded from external files.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Register tools from registry
    for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
      this.registerToolIfAvailable(toolName, entry)
    }

    // Initialize invocation builder with registered tools
    this.invocationBuilder = new ToolInvocationBuilder(this.tools)

    this.initialized = true
  }

  /**
   * Atomically replace specific tools with new service dependencies.
   * Build-then-swap pattern: builds new tool instances first, only swaps if all succeed.
   * Throws if any requested tool cannot be rebuilt (no partial swap).
   */
  public replaceTools(toolNames: string[], newServices: Record<string, unknown>): void {
    // 0. Runtime key validation — catch typos in Record<string, unknown> early
    for (const key of Object.keys(newServices)) {
      if (!ToolProvider.VALID_SERVICE_KEYS.has(key)) {
        throw new Error(`replaceTools: unknown service key "${key}" — valid keys: ${[...ToolProvider.VALID_SERVICE_KEYS].join(', ')}`)
      }
    }

    // 1. Merge new services into existing (cast from Record to ToolServices)
    const mergedServices: ToolServices = {
      ...this.services,
      ...newServices as Partial<ToolServices>,
    }

    // 2. Deduplicate input tool names
    const uniqueToolNames = [...new Set(toolNames)]

    // 3. Stage new tool instances — fail hard if any tool cannot be built
    const stagedTools = new Map<string, Tool>()
    for (const toolName of uniqueToolNames) {
      const entry = TOOL_REGISTRY[toolName as keyof typeof TOOL_REGISTRY]
      if (!entry) {
        throw new Error(`replaceTools: unknown tool "${toolName}" not in TOOL_REGISTRY`)
      }

      // Check required services
      const allServicesAvailable = entry.requiredServices.every(
        (serviceName) => mergedServices[serviceName] !== undefined,
      )
      if (!allServicesAvailable) {
        throw new Error(
          `replaceTools: missing required services for "${toolName}": ${entry.requiredServices.join(', ')}`,
        )
      }

      // Build tool (throws on factory failure — old tools remain intact)
      const tool = entry.factory(mergedServices)

      // Apply description loader overrides
      const fileDescription = this.loadExternalDescription(entry.descriptionFile)
      if (fileDescription) {
        tool.description = fileDescription
      }

      stagedTools.set(toolName, tool)
    }

    // 4. Swap atomically — only reached if ALL builds succeeded
    this.services = mergedServices
    for (const [name, tool] of stagedTools) {
      this.tools.set(name, tool)
    }

    // 5. Recompute markers from all registered tools
    this.toolMarkers.clear()
    for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
      if (this.tools.has(toolName)) {
        for (const marker of entry.markers) {
          this.toolMarkers.add(marker)
        }
      }
    }

    // 6. Rebuild invocationBuilder
    if (this.initialized && this.invocationBuilder) {
      this.invocationBuilder = new ToolInvocationBuilder(this.tools)
    }
  }

  /**
   * Update services and re-register tools that depend on newly available services.
   * This is used to inject services that are created after ToolProvider initialization
   * (e.g., SessionManager which is created after ToolProvider).
   *
   * @param additionalServices - Additional services to add
   */
  public updateServices(additionalServices: Partial<ToolServices>): void {
    // Merge new services into existing services
    this.services = {...this.services, ...additionalServices}

    // Re-register tools that may now have their required services available
    for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
      // Skip if tool is already registered
      if (this.tools.has(toolName)) {
        continue
      }

      this.registerToolIfAvailable(toolName, entry)
    }

    // Update invocation builder with any newly registered tools
    if (this.initialized && this.invocationBuilder) {
      this.invocationBuilder = new ToolInvocationBuilder(this.tools)
    }
  }

  /**
   * Ensures the provider is initialized.
   * @throws ToolProviderNotInitializedError if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ToolProviderNotInitializedError()
    }
  }

  /**
   * Loads description from external file if configured.
   * @param descriptionFile - The description file name (without .txt extension)
   * @returns The loaded description or undefined if not available
   */
  private loadExternalDescription(descriptionFile: string | undefined): string | undefined {
    if (!descriptionFile || !this.descriptionLoader) {
      return undefined
    }

    return this.descriptionLoader.load(descriptionFile)
  }

  /**
   * Registers a single tool if all required services are available.
   * @param toolName - Name of the tool to register
   * @param entry - Registry entry for the tool
   */
  private registerToolIfAvailable(toolName: string, entry: (typeof TOOL_REGISTRY)[keyof typeof TOOL_REGISTRY]): void {
    const allServicesAvailable = entry.requiredServices.every(
      (serviceName) => this.services[serviceName] !== undefined,
    )

    if (!allServicesAvailable) {
      return
    }

    try {
      const tool = entry.factory(this.services)

      // Override description from external file if available
      const fileDescription = this.loadExternalDescription(entry.descriptionFile)
      if (fileDescription) {
        tool.description = fileDescription
      }

      this.tools.set(toolName, tool)

      // Collect markers from registered tools
      for (const marker of entry.markers) {
        this.toolMarkers.add(marker)
      }
    } catch {
      // Silently skip - don't fail initialization or disrupt TUI
    }
  }
}