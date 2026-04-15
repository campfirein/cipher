import type {
  ProviderCapabilities,
  ProviderType,
  QueryRequest,
  QueryResult,
  QueryType,
} from '../domain/swarm/types.js'

/**
 * Metadata about a single provider's contribution to a swarm query.
 */
export type ProviderQueryMeta = {
  /** Which provider enriched this provider's query (if any) */
  enrichedBy?: string
  /** Content excerpts injected via enrichment from predecessors */
  enrichmentExcerpts?: string[]
  /** Why this provider was excluded (only when selected=false) */
  excludeReason?: string
  /** How long this provider took to respond */
  latencyMs: number
  /** How many results this provider returned */
  resultCount: number
  /** Whether this provider was selected for this query */
  selected: boolean
}

/**
 * Metadata about the overall swarm query execution.
 */
export type QueryMeta = {
  /** Total monetary cost across all cloud providers */
  costCents: number
  /** Per-provider execution metadata */
  providers: Record<string, ProviderQueryMeta>
  /** How the query was classified */
  queryType: QueryType
  /** End-to-end latency including routing, execution, and merging */
  totalLatencyMs: number
}

/**
 * Complete result from a swarm query — results + execution metadata.
 */
export type SwarmQueryResult = {
  /** Execution metadata (providers used, latency, cost) */
  meta: QueryMeta
  /** Ranked, fused results from all active providers */
  results: QueryResult[]
}

/**
 * Summary info about a registered provider (for status display).
 */
export type ProviderInfo = {
  /** Provider capabilities */
  capabilities: ProviderCapabilities
  /** Whether the provider is currently reachable */
  healthy: boolean
  /** Provider identifier */
  id: string
  /** Provider type (local/cloud) */
  type: ProviderType
}

/**
 * Presentation-oriented summary of the swarm state.
 * Used by CLI status, system prompt contributor, and REPL commands.
 */
export type SwarmSummary = {
  /** Number of active (healthy + enabled) providers */
  activeCount: number
  /** Average query latency in milliseconds */
  avgLatencyMs: number
  /** Learning status */
  learningStatus: 'cold-start' | 'converged' | 'learning'
  /** Monthly budget cap in cents */
  monthlyBudgetCents: number
  /** Monthly spend so far in cents */
  monthlySpendCents: number
  /** Per-provider summaries */
  providers: ProviderInfo[]
  /** Total number of registered providers */
  totalCount: number
  /** Total queries executed */
  totalQueries: number
}

/**
 * Request to store knowledge via the swarm.
 */
export type SwarmStoreRequest = {
  /** The knowledge content to store */
  content: string
  /** Optional write type hint — skips classification when provided */
  contentType?: 'entity' | 'general' | 'note'
  /** Explicit target provider ID — overrides classification */
  provider?: string
}

/**
 * Result from a swarm store operation.
 */
export type SwarmStoreResult = {
  /** Error message if store failed */
  error?: string
  /** True when content was routed to context tree as fallback (no external providers available) */
  fallback?: boolean
  /** ID assigned by the target provider */
  id: string
  /** Store latency in milliseconds */
  latencyMs: number
  /** Provider that stored the content */
  provider: string
  /** Whether the store succeeded */
  success: boolean
}

/**
 * Central coordinator for the memory swarm.
 * Routes queries to providers, executes the graph, and fuses results.
 * Routes store operations to the best writable provider.
 */
export interface ISwarmCoordinator {
  /**
   * Execute a swarm query — route, execute providers, fuse results.
   */
  execute(request: QueryRequest): Promise<SwarmQueryResult>

  /**
   * Get info about all registered providers and their health status.
   */
  getActiveProviders(): ProviderInfo[]

  /**
   * Get a presentation-oriented summary of the swarm state.
   */
  getSummary(): SwarmSummary

  /**
   * Store knowledge in the best writable provider.
   * Routes by content type or explicit provider target.
   */
  store(request: SwarmStoreRequest): Promise<SwarmStoreResult>
}
