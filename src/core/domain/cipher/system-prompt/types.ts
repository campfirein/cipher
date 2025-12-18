import type {MemoryManager} from '../../../../infra/cipher/memory/memory-manager.js'
import type {EnvironmentContext} from '../../../../infra/cipher/system-prompt/environment-context-builder.js'

/**
 * Conversation metadata for execution context
 */
export interface ConversationMetadata {
  /** ID of the conversation */
  conversationId: string

  /** Title of the conversation */
  title: string
}

/**
 * Context passed to system prompt contributors at runtime.
 * This allows contributors to access runtime dependencies and configuration.
 */
export interface SystemPromptContext {
  /** Additional context properties */
  [key: string]: unknown

  /** Set of available tool marker strings */
  availableMarkers?: Set<string>

  /** Array of available tool names */
  availableTools?: string[]

  /** Metadata about the conversation (for JSON input mode) */
  conversationMetadata?: ConversationMetadata

  /** Whether running in JSON input mode (headless with conversation history) */
  isJsonInputMode?: boolean
}

/**
 * Extended context for contributor execution.
 * Includes runtime dependencies needed by contributors.
 */
export interface ContributorContext {
  /** Available markers and their descriptions */
  availableMarkers?: Record<string, string>

  /** List of available tool names */
  availableTools?: string[]

  /** Type of command being executed */
  commandType?: 'chat' | 'curate' | 'query'

  /** Metadata about the current conversation */
  conversationMetadata?: {conversationId?: string; title?: string}

  /** Environment context with working directory, git status, file tree, etc. */
  environmentContext?: EnvironmentContext

  /** Instructions for file reference handling */
  fileReferenceInstructions?: string

  /** Memory manager instance for accessing memories */
  memoryManager?: MemoryManager
}

/**
 * Interface for system prompt contributors.
 *
 * Contributors generate portions of the system prompt that are
 * combined by the SystemPromptManager.
 */
export interface SystemPromptContributor {
  /**
   * Generate the content for this contributor.
   *
   * @param context - Runtime context with dependencies
   * @returns Prompt content string
   */
  getContent(context: ContributorContext): Promise<string>

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number
}

/**
 * Configuration for a static contributor.
 * Static contributors return the base system prompt from YAML or custom content.
 */
export interface StaticContributorConfig {
  /** Optional category for YAML file (e.g., 'base', 'contributors') */
  category?: string

  /** Optional custom content to return (overrides YAML) */
  content?: string

  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Optional filename for YAML file (without .yml extension) */
  filename?: string

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'static'
}

/**
 * Configuration for a date-time contributor.
 * Provides current date and time in ISO format.
 */
export interface DateTimeContributorConfig {
  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'dateTime'
}

/**
 * Options for memory contributor configuration.
 * Controls how memories are retrieved and formatted in the system prompt.
 */
export interface MemoryContributorOptions {
  /** Whether to include tags in memory display (default: true) */
  includeTags?: boolean

  /** Whether to include timestamps in memory display (default: false) */
  includeTimestamps?: boolean

  /** Maximum number of memories to include */
  limit?: number

  /** Only include pinned memories (for hybrid approach, default: false) */
  pinnedOnly?: boolean

  /** Filter by memory source (agent, system, or user) */
  source?: 'agent' | 'system' | 'user'
}

/**
 * Configuration for a memory contributor.
 * Retrieves and formats agent memories for inclusion in the system prompt.
 */
export interface MemoryContributorConfig {
  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Unique identifier for this contributor */
  id: string

  /** Options for memory retrieval and formatting */
  options?: MemoryContributorOptions

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'memory'
}

/**
 * Configuration for an execution mode contributor.
 * Provides context-specific instructions based on execution mode (e.g., JSON input mode).
 */
export interface ExecutionModeContributorConfig {
  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'executionMode'
}

/**
 * Configuration for a marker-based prompt contributor.
 * Generates prompt sections based on available tool markers.
 */
export interface MarkerPromptContributorConfig {
  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'markerPrompt'
}

/**
 * Union type for all contributor configurations.
 * Uses discriminated union for type-safe contributor creation.
 */
export type ContributorConfig =
  | DateTimeContributorConfig
  | ExecutionModeContributorConfig
  | MarkerPromptContributorConfig
  | MemoryContributorConfig
  | StaticContributorConfig

/**
 * Configuration for the system prompt manager.
 */
export interface SystemPromptConfig {
  /** Array of contributor configurations */
  contributors: ContributorConfig[]
}
