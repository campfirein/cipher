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
  /** API base URL (empty for internal providers, SDK-managed for Google) */
  readonly baseUrl: string
  /** Category for grouping in UI */
  readonly category: 'other' | 'popular'
  /** Default model to use when first connected */
  readonly defaultModel?: string
  /** Short description */
  readonly description: string
  /** Environment variable names to check for API key auto-detection */
  readonly envVars?: readonly string[]
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
  anthropic: {
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com',
    category: 'popular',
    defaultModel: 'claude-sonnet-4-5-20250929',
    description: 'Claude models by Anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    headers: {},
    id: 'anthropic',
    modelsEndpoint: '/v1/models',
    name: 'Anthropic',
    priority: 2,
  },
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
  google: {
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    baseUrl: '',
    category: 'popular',
    defaultModel: 'gemini-2.5-flash',
    description: 'Gemini models by Google',
    envVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    headers: {},
    id: 'google',
    modelsEndpoint: '',
    name: 'Google Gemini',
    priority: 4,
  },
  'google-vertex': {
    apiKeyUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    baseUrl: '',
    category: 'popular',
    defaultModel: 'gemini-2.5-flash',
    description: 'Gemini via Google Cloud Vertex AI',
    envVars: ['GOOGLE_APPLICATION_CREDENTIALS'],
    headers: {},
    id: 'google-vertex',
    modelsEndpoint: '',
    name: 'Google Vertex AI',
    priority: 5,
  },
  groq: {
    apiKeyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    category: 'popular',
    defaultModel: 'llama-3.3-70b-versatile',
    description: 'Fast inference on open models',
    envVars: ['GROQ_API_KEY'],
    headers: {},
    id: 'groq',
    modelsEndpoint: '/models',
    name: 'Groq',
    priority: 6,
  },
  mistral: {
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    category: 'popular',
    defaultModel: 'mistral-large-latest',
    description: 'Mistral AI models',
    envVars: ['MISTRAL_API_KEY'],
    headers: {},
    id: 'mistral',
    modelsEndpoint: '/models',
    name: 'Mistral',
    priority: 7,
  },
  openai: {
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    category: 'popular',
    defaultModel: 'gpt-4.1',
    description: 'GPT models by OpenAI',
    envVars: ['OPENAI_API_KEY'],
    headers: {},
    id: 'openai',
    modelsEndpoint: '/models',
    name: 'OpenAI',
    priority: 3,
  },
  openrouter: {
    apiKeyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    category: 'popular',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    description: 'Access 200+ models via aggregator',
    envVars: ['OPENROUTER_API_KEY'],
    headers: {
      'HTTP-Referer': 'https://byterover.dev',
      'X-Title': 'byterover-cli',
    },
    id: 'openrouter',
    modelsEndpoint: '/models',
    name: 'OpenRouter',
    priority: 1,
  },
  xai: {
    apiKeyUrl: 'https://console.x.ai',
    baseUrl: 'https://api.x.ai/v1',
    category: 'popular',
    defaultModel: 'grok-3-mini',
    description: 'Grok models by xAI',
    envVars: ['XAI_API_KEY'],
    headers: {},
    id: 'xai',
    modelsEndpoint: '/models',
    name: 'xAI (Grok)',
    priority: 5,
  },
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
  // Internal providers (byterover) don't need API keys.
  // Vertex AI uses Application Default Credentials, not API keys.
  if (id === 'byterover' || id === 'google-vertex') return false

  return true
}
