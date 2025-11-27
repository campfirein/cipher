import { ZodError } from 'zod'

import type { Tool, ToolExecutionContext, ToolSet } from '../../../core/domain/cipher/tools/types.js'
import type { IToolProvider } from '../../../core/interfaces/cipher/i-tool-provider.js'
import type { SimplePromptFactory } from '../system-prompt/simple-prompt-factory.js'
import type { ToolServices } from './tool-registry.js'

import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolProviderNotInitializedError,
  ToolValidationError,
} from '../../../core/domain/cipher/errors/tool-error.js'
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
  private initialized: boolean = false
  private invocationBuilder?: ToolInvocationBuilder
  private readonly promptFactory?: SimplePromptFactory
  private readonly services: ToolServices
  private readonly toolMarkers: Set<string> = new Set()
  private readonly tools: Map<string, Tool> = new Map()

  /**
   * Creates a new tool provider
   * @param services - Services available to tools
   * @param promptFactory - Optional prompt factory for tool output guidance
   */
  public constructor(services: ToolServices, promptFactory?: SimplePromptFactory) {
    this.services = services
    this.promptFactory = promptFactory
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
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolValidationError if input validation fails
   * @throws ToolExecutionError if execution fails
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    this.ensureInitialized()

    if (!this.invocationBuilder) {
      throw new ToolProviderNotInitializedError()
    }

    try {
      // Phase 1: Build and validate invocation
      const context: ToolExecutionContext = {sessionId}
      const invocation = this.invocationBuilder.build(
        `tool_call_${Date.now()}`, // Generate unique ID
        toolName,
        args,
        context
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
      if (registryEntry?.outputGuidance && this.promptFactory) {
        const guidance = this.promptFactory.getToolOutputGuidance(registryEntry.outputGuidance)

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
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Register tools from registry
    for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
      // Check if all required services are available
      const allServicesAvailable = entry.requiredServices.every(
        (serviceName) => this.services[serviceName] !== undefined,
      )

      if (allServicesAvailable) {
        try {
          const tool = entry.factory(this.services)
          this.tools.set(toolName, tool)

          // Collect markers from registered tools
          for (const marker of entry.markers) {
            this.toolMarkers.add(marker)
          }
        } catch (error) {
          // Log error but don't fail initialization
          console.error(`Failed to register tool ${toolName}:`, error)
        }
      }
    }

    // Initialize invocation builder with registered tools
    this.invocationBuilder = new ToolInvocationBuilder(this.tools)

    this.initialized = true
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
}