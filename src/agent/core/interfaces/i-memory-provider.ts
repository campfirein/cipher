import type {
  CostEstimate,
  HealthStatus,
  MemoryEntry,
  ProviderCapabilities,
  ProviderType,
  QueryRequest,
  QueryResult,
  StoreResult,
} from '../domain/swarm/types.js'

/**
 * Unified interface for memory providers.
 * Every memory provider (ByteRover, Obsidian, Honcho, etc.) implements this contract.
 * The swarm graph operates exclusively through this interface.
 */
export interface IMemoryProvider {
  /** Provider capabilities (search types, write support, latency) */
  readonly capabilities: ProviderCapabilities

  /**
   * Delete a memory entry.
   * @throws if the entry doesn't exist or provider is read-only
   */
  delete(id: string): Promise<void>

  /**
   * Estimate the cost of executing a query.
   * Used by the router for budget-aware dispatching.
   */
  estimateCost(request: QueryRequest): CostEstimate

  /**
   * Check if this provider is reachable and functional.
   * Used by the control plane to skip unavailable providers.
   */
  healthCheck(): Promise<HealthStatus>

  /** Unique provider identifier */
  readonly id: string

  /**
   * Query this provider for relevant memories.
   * The core operation — every provider MUST support this.
   */
  query(request: QueryRequest): Promise<QueryResult[]>

  /**
   * Store a memory entry into this provider.
   * Not all providers support writes (e.g., Obsidian may be read-only).
   * @throws if the provider is read-only
   */
  store(entry: MemoryEntry): Promise<StoreResult>

  /** Provider type for routing decisions */
  readonly type: ProviderType

  /**
   * Update an existing memory entry.
   * @throws if the entry doesn't exist or provider is read-only
   */
  update(id: string, entry: Partial<MemoryEntry>): Promise<void>
}
