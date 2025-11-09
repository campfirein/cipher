/**
 * Context passed to dynamic contributors for runtime prompt generation
 */
export interface DynamicContributorContext {
  // Future: Add MCPManager, MemoryManager, etc.
  [key: string]: unknown
}

/**
 * Interface for system prompt contributors
 * Each contributor provides a piece of the final system prompt
 */
export interface SystemPromptContributor {
  /**
   * Whether this contributor is enabled
   */
  enabled: boolean

  /**
   * Generate this contributor's content
   * @param context - Runtime context for dynamic generation
   * @returns The content to include in system prompt
   */
  getContent(context: DynamicContributorContext): Promise<string>

  /**
   * Unique identifier for this contributor
   */
  id: string

  /**
   * Priority determines order in final prompt (lower = higher priority)
   */
  priority: number
}

/**
 * Configuration for system prompt management
 */
export interface SystemPromptConfig {
  /**
   * Base directory for file-based contributors (future)
   */
  configDir?: string

  /**
   * Custom system prompt content (optional)
   * If provided, will be added as a static contributor with priority 0
   */
  customPrompt?: string
}
