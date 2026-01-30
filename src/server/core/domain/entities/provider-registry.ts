/**
 * Provider Registry
 *
 * Defines available LLM providers that can be connected to byterover-cli.
 * Inspired by OpenCode's provider system.
 */

/**
 * Definition for an LLM provider.
 */
export interface ProviderDefinition {
  /** URL where users can get an API key */
  readonly apiKeyUrl?: string
  /** API base URL (empty for internal providers) */
  readonly baseUrl: string
  /** Category for grouping in UI */
  readonly category: 'other' | 'popular'
  /** Default model to use when first connected */
  readonly defaultModel?: string
  /** Short description */
  readonly description: string
  /** Default headers for API requests */
  readonly headers: Readonly<Record<string, string>>
  /** Unique provider identifier */
  readonly id: string
  /** Endpoint to fetch available models */
  readonly modelsEndpoint: string
  /** Display name */
  readonly name: string
  /** Priority for display order (lower = higher priority) */
  readonly priority: number
}

/**
 * Registry of all available providers.
 * Order by priority for consistent display.
 */
export const PROVIDER_REGISTRY: Readonly<Record<string, ProviderDefinition>> = {
  byterover: {
    baseUrl: '',
    category: 'popular',
    description: 'Internal ByteRover LLM',
    headers: {},
    id: 'byterover',
    modelsEndpoint: '',
    name: 'ByteRover',
    priority: 0,
  },
  openrouter: {
    apiKeyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    category: 'popular',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    description: 'Access 200+ models',
    headers: {
      'HTTP-Referer': 'https://byterover.dev',
      'X-Title': 'byterover-cli',
    },
    id: 'openrouter',
    modelsEndpoint: '/models',
    name: 'OpenRouter',
    priority: 1,
  },
  // Future providers can be added here:
  // anthropic: { ... },
  // openai: { ... },
  // google: { ... },
  // groq: { ... },
}

/**
 * Get all providers sorted by priority.
 */
export function getProvidersSortedByPriority(): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY).sort((a, b) => a.priority - b.priority)
}

/**
 * Get providers grouped by category.
 */
export function getProvidersGroupedByCategory(): {
  other: ProviderDefinition[]
  popular: ProviderDefinition[]
} {
  const providers = getProvidersSortedByPriority()
  return {
    other: providers.filter((p) => p.category === 'other'),
    popular: providers.filter((p) => p.category === 'popular'),
  }
}

/**
 * Get a provider by ID.
 */
export function getProviderById(id: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY[id]
}

/**
 * Check if a provider requires an API key.
 */
export function providerRequiresApiKey(id: string): boolean {
  const provider = getProviderById(id)
  if (!provider) return false
  // Internal providers (empty baseUrl) don't need API keys
  return provider.baseUrl.length > 0
}
