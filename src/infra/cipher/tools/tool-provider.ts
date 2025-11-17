import {ZodError} from 'zod'

import type {Tool, ToolExecutionContext, ToolSet} from '../../../core/domain/cipher/tools/types.js'
import type {IToolProvider} from '../../../core/interfaces/cipher/i-tool-provider.js'
import type {ToolServices} from './tool-registry.js'

import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolProviderNotInitializedError,
  ToolValidationError,
} from '../../../core/domain/cipher/errors/tool-error.js'
import {ToolMarker} from './tool-markers.js'
import {TOOL_REGISTRY} from './tool-registry.js'
import {convertZodToJsonSchema} from './utils/schema-converter.js'

/**
 * Tool provider implementation.
 * Manages tool lifecycle: registration, validation, and execution.
 */
export class ToolProvider implements IToolProvider {
  private initialized: boolean = false
  private readonly services: ToolServices
  private readonly toolMarkers: Set<string> = new Set()
  private readonly tools: Map<string, Tool> = new Map()

  /**
   * Creates a new tool provider
   * @param services - Services available to tools
   */
  public constructor(services: ToolServices) {
    this.services = services
  }

  /**
   * Execute a tool with the given arguments.
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    this.ensureInitialized()

    // Get tool
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new ToolNotFoundError(toolName)
    }

    // Validate input against schema
    try {
      const validatedInput = tool.inputSchema.parse(args)

      // Create execution context
      const context: ToolExecutionContext = {
        sessionId,
      }

      // Execute tool
      const result = await tool.execute(validatedInput, context)
      return result
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join('; ')
        throw new ToolValidationError(toolName, errorMessages)
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