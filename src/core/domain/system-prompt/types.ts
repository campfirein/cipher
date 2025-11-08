/**
 * Context passed to system prompt contributors at runtime.
 * This allows contributors to access runtime dependencies and configuration.
 * Currently empty, but can be extended to include services, user data, etc.
 */
export interface SystemPromptContext {
  [key: string]: unknown
}

/**
 * Configuration for a static contributor.
 * Static contributors return a fixed string content.
 */
export interface StaticContributorConfig {
  /** The fixed content to return */
  content: string

  /** Whether this contributor is enabled (default: true) */
  enabled?: boolean

  /** Unique identifier for this contributor */
  id: string

  /** Priority for ordering (lower = higher priority) */
  priority: number

  /** Type discriminator */
  type: 'static'
}

/**
 * Union type for all contributor configurations.
 * Currently only includes static, but designed for future extension.
 */
export type ContributorConfig = StaticContributorConfig

/**
 * Configuration for the system prompt manager.
 */
export interface SystemPromptConfig {
  /** Array of contributor configurations */
  contributors: ContributorConfig[]
}
