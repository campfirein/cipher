import type {ZodSchema} from 'zod'

/**
 * Callback function for tools to push metadata updates during execution.
 * Called by tools to stream real-time updates to the UI/LLM.
 */
export type MetadataCallback = (update: ToolMetadataUpdate) => void

/**
 * Risk level for tool execution.
 * Used for logging, auditing, and policy decisions.
 */
export type RiskLevel = 'critical' | 'high' | 'low' | 'medium'

/**
 * Real-time metadata update from a tool during execution.
 * Allows tools to push incremental updates (e.g., streaming bash output).
 */
export interface ToolMetadataUpdate {
  /** Additional custom metadata */
  [key: string]: unknown

  /** Human-readable description of current status */
  description?: string

  /** Streamed output content (e.g., bash stdout/stderr) */
  output?: string

  /** Progress indicator (0-100) */
  progress?: number
}

/**
 * Semantic category for tools.
 * Helps classify tools by their primary function.
 */
export type ToolCategory = 'discovery' | 'execute' | 'memory' | 'read' | 'write'

/**
 * Metadata about a tool execution.
 * Computed dynamically based on tool arguments.
 */
export interface ToolMetadata {
  /**
   * Files or directories that may be affected.
   * Computed from tool arguments.
   */
  affectedLocations?: string[]

  /**
   * Semantic category of this tool.
   */
  category?: ToolCategory

  /**
   * Risk level for this execution.
   * Useful for logging and auditing.
   */
  riskLevel: RiskLevel
}

/**
 * Represents a tool that can be executed by the LLM.
 * Tools are the primary way for the LLM to interact with the system.
 */
export interface Tool {
  /** Human-readable description of what the tool does */
  description: string

  /**
   * The actual function that executes the tool.
   * Input is pre-validated against inputSchema before execution.
   *
   * @param input - Validated input parameters
   * @param context - Optional execution context
   * @returns Tool execution result
   */
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown

  /**
   * Optional: Get metadata about this tool execution.
   * Used for logging, auditing, and policy decisions.
   *
   * @param args - The arguments being passed to the tool
   * @returns Metadata about this execution
   */
  getMetadata?: (args: Record<string, unknown>) => ToolMetadata

  /** Unique identifier for the tool */
  id: string

  /** Zod schema defining the input parameters - validated before execution */
  inputSchema: ZodSchema
}

/**
 * Context provided to tools during execution.
 * Contains metadata about the execution environment.
 */
export interface ToolExecutionContext {
  /**
   * Callback for streaming metadata updates during execution.
   * Tools can use this to push real-time output (e.g., bash streaming).
   */
  metadata?: MetadataCallback

  /** Session ID if available */
  sessionId?: string

  /**
   * Abort signal for cancelling long-running operations.
   * Tools should check this signal periodically and abort gracefully.
   */
  signal?: AbortSignal

  /** Task ID from usecase for billing tracking */
  taskId?: string
}

/**
 * Tool set exposed to the LLM.
 * Maps tool names to their JSON Schema definitions for LLM consumption.
 */
export interface ToolSet {
  [toolName: string]: {
    /** Human-readable description */
    description?: string

    /** Tool name (same as key) */
    name?: string

    /** JSON Schema v7 definition of parameters */
    parameters: JSONSchema7
  }
}

/**
 * JSON Schema v7 type definition.
 * Simplified version for tool parameter schemas.
 */
export interface JSONSchema7 {
  $id?: string
  $ref?: string
  $schema?: string
  additionalItems?: boolean | JSONSchema7
  additionalProperties?: boolean | JSONSchema7
  allOf?: JSONSchema7[]
  anyOf?: JSONSchema7[]
  const?: unknown
  contains?: JSONSchema7
  contentEncoding?: string
  contentMediaType?: string
  default?: unknown
  definitions?: {
    [key: string]: JSONSchema7
  }
  dependencies?: {
    [key: string]: JSONSchema7 | string[]
  }
  description?: string
  else?: JSONSchema7
  enum?: unknown[]
  examples?: unknown[]
  exclusiveMaximum?: number
  exclusiveMinimum?: number
  format?: string
  if?: JSONSchema7
  items?: JSONSchema7 | JSONSchema7[]
  maximum?: number
  maxItems?: number
  maxLength?: number
  maxProperties?: number
  minimum?: number
  minItems?: number
  minLength?: number
  minProperties?: number
  multipleOf?: number
  not?: JSONSchema7
  oneOf?: JSONSchema7[]
  pattern?: string
  patternProperties?: {
    [key: string]: JSONSchema7
  }
  properties?: {
    [key: string]: JSONSchema7
  }
  propertyNames?: JSONSchema7
  readOnly?: boolean
  required?: string[]
  then?: JSONSchema7
  title?: string
  type?: JSONSchema7TypeName | JSONSchema7TypeName[]
  uniqueItems?: boolean
  writeOnly?: boolean
}

/**
 * JSON Schema type names.
 */
export type JSONSchema7TypeName =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string'