/**
 * Domain configurations for the context tree structure.
 * Each domain represents a specific area of knowledge in the project.
 *
 * @deprecated Domains are now created dynamically based on content semantics.
 * This file is kept for backward compatibility only.
 */
export interface DomainConfig {
  description: string
  name: string
}

/**
 * Example domain names for reference only.
 * Domains are now created dynamically by the agent based on content.
 *
 * @deprecated Domains are created dynamically. These are kept as examples only.
 */
export const EXAMPLE_DOMAIN_NAMES = [
  'authentication',
  'api_design',
  'data_models',
  'error_handling',
  'ui_components',
  'testing_patterns',
  'configuration',
  'logging',
  'security',
  'performance',
] as const

/**
 * @deprecated Domains are now created dynamically based on content semantics.
 * The agent will create domain names that are semantically meaningful for the curated content.
 * This constant is kept for backward compatibility but is no longer used.
 */
export const DEFAULT_CONTEXT_TREE_DOMAINS: DomainConfig[] = []

/**
 * Alias for backward compatibility.
 * @deprecated Domains are created dynamically. This constant is no longer used.
 */
export const CONTEXT_TREE_DOMAINS = DEFAULT_CONTEXT_TREE_DOMAINS
