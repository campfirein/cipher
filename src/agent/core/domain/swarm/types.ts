/**
 * All supported memory provider types.
 */
export const PROVIDER_TYPES = [
  'byterover',
  'honcho',
  'hindsight',
  'obsidian',
  'local-markdown',
  'gbrain',
] as const

/**
 * Union type of supported memory provider identifiers.
 */
export type ProviderType = (typeof PROVIDER_TYPES)[number]

/**
 * Query type classification for routing decisions.
 */
export type QueryType = 'creative' | 'factual' | 'personal' | 'relational' | 'temporal'

/**
 * Local providers that require no network calls.
 */
const LOCAL_PROVIDERS: ReadonlySet<ProviderType> = new Set(['byterover', 'local-markdown', 'obsidian'])

/**
 * Check if a provider type is local (no network required).
 */
export function isLocalProvider(type: ProviderType): boolean {
  return LOCAL_PROVIDERS.has(type)
}

/**
 * Check if a provider type requires network/cloud access.
 */
export function isCloudProvider(type: ProviderType): boolean {
  return !LOCAL_PROVIDERS.has(type)
}

/**
 * Capabilities that a memory provider can expose.
 */
export type ProviderCapabilities = {
  /** Average response time in milliseconds */
  avgLatencyMs: number
  /** Can follow entity links / graph edges */
  graphTraversal: boolean
  /** BM25 / full-text search */
  keywordSearch: boolean
  /** No network calls needed */
  localOnly: boolean
  /** Context budget per query */
  maxTokensPerQuery: number
  /** Vector similarity search */
  semanticSearch: boolean
  /** Time-range filtering */
  temporalQuery: boolean
  /** Psychological profiles / user preferences */
  userModeling: boolean
  /** Can store new memories */
  writeSupported: boolean
}

/**
 * A single memory entry stored in a provider.
 */
export type MemoryEntry = {
  content: string
  metadata: {
    confidence?: number
    entities?: string[]
    expiresAt?: number
    relations?: string[]
    source: string
    tags?: string[]
    timestamp: number
  }
}

/**
 * Request to query a memory provider.
 */
export type QueryRequest = {
  /** Enrichment data from predecessor providers (for graph execution) */
  enrichment?: {
    context?: string
    entities?: string[]
    keywords?: string[]
  }
  /** Whether to return provenance info */
  includeMetadata?: boolean
  /** Limit results */
  maxResults?: number
  /** Token budget for this provider */
  maxTokens?: number
  /** The natural language query */
  query: string
  /** Restrict to subtree/namespace */
  scope?: string
  /** Temporal filter */
  timeRange?: {
    after?: number
    before?: number
  }
  /** Hint: factual, temporal, personal, creative, relational */
  type?: QueryType
}

/**
 * A single result from a memory provider query.
 */
export type QueryResult = {
  content: string
  id: string
  metadata: {
    confidence?: number
    matchType: 'graph' | 'keyword' | 'profile' | 'semantic' | 'temporal'
    path?: string
    source: string
    timestamp?: number
  }
  provider: string
  providerType: ProviderType
  score: number
}

/**
 * Human-readable source label for a provider, used in CLI output.
 */
export function providerTypeToLabel(type: ProviderType, id: string): string {
  switch (type) {
    case 'byterover': { return 'context-tree'
    }

    case 'gbrain': { return 'gbrain'
    }

    case 'hindsight': { return 'hindsight'
    }

    case 'honcho': { return 'honcho'
    }

    case 'local-markdown': {
      const name = id.split(':')[1] ?? 'files'
      return `notes:${name}`
    }

    case 'obsidian': { return 'obsidian'
    }
  }
}

/**
 * Result from storing a memory entry.
 */
export type StoreResult = {
  id: string
  provider: string
  success: boolean
}

/**
 * Health status of a memory provider.
 */
export type HealthStatus = {
  available: boolean
  error?: string
  latencyMs?: number
}

/**
 * Cost estimate for executing a query against a provider.
 */
export type CostEstimate = {
  estimatedCostCents: number
  estimatedLatencyMs: number
  estimatedTokens: number
}

/* eslint-disable perfectionist/sort-switch-case */

/**
 * Create default capabilities for a given provider type.
 * Used for initialization before actual provider reports its capabilities.
 */
export function createDefaultCapabilities(type: ProviderType): ProviderCapabilities {
  switch (type) {
    case 'byterover': {
      return {
        avgLatencyMs: 50,
        graphTraversal: false,
        keywordSearch: true,
        localOnly: true,
        maxTokensPerQuery: 8000,
        semanticSearch: false,
        temporalQuery: false,
        userModeling: false,
        writeSupported: true,
      }
    }

    case 'obsidian': {
      return {
        avgLatencyMs: 100,
        graphTraversal: true,
        keywordSearch: true,
        localOnly: true,
        maxTokensPerQuery: 8000,
        semanticSearch: false,
        temporalQuery: false,
        userModeling: false,
        writeSupported: false,
      }
    }

    case 'local-markdown': {
      return {
        avgLatencyMs: 80,
        graphTraversal: true,
        keywordSearch: true,
        localOnly: true,
        maxTokensPerQuery: 6000,
        semanticSearch: false,
        temporalQuery: false,
        userModeling: false,
        writeSupported: true,
      }
    }

    case 'honcho': {
      return {
        avgLatencyMs: 500,
        graphTraversal: false,
        keywordSearch: false,
        localOnly: false,
        maxTokensPerQuery: 16_000,
        semanticSearch: true,
        temporalQuery: true,
        userModeling: true,
        writeSupported: true,
      }
    }

    case 'hindsight': {
      return {
        avgLatencyMs: 300,
        graphTraversal: true,
        keywordSearch: true,
        localOnly: false,
        maxTokensPerQuery: 12_000,
        semanticSearch: true,
        temporalQuery: true,
        userModeling: false,
        writeSupported: true,
      }
    }

    case 'gbrain': {
      return {
        avgLatencyMs: 200,
        graphTraversal: false,
        keywordSearch: true,
        localOnly: false,
        maxTokensPerQuery: 10_000,
        semanticSearch: true,
        temporalQuery: true,
        userModeling: false,
        writeSupported: true,
      }
    }
  }
}
