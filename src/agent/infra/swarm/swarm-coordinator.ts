import type {QueryRequest} from '../../core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../core/interfaces/i-memory-provider.js'
import type {
  ISwarmCoordinator,
  ProviderInfo,
  SwarmQueryResult,
  SwarmSummary,
} from '../../core/interfaces/i-swarm-coordinator.js'
import type {SwarmConfig} from './config/swarm-config-schema.js'

import {SwarmGraph} from './swarm-graph.js'
import {mergeResults} from './swarm-merger.js'
import {classifyQuery, selectProviders} from './swarm-router.js'

/**
 * Default provider weights for RRF fusion.
 * ByteRover (home provider) gets highest weight.
 */
const DEFAULT_WEIGHTS: Record<string, number> = {
  byterover: 1,
  gbrain: 0.7,
  hindsight: 0.8,
  honcho: 0.75,
  'local-markdown': 0.8,
  obsidian: 0.85,
}

/**
 * Resolves the weight for a provider ID.
 * Supports prefixed IDs like `local-markdown:notes` → matches `local-markdown`.
 */
function resolveWeight(providerId: string): number {
  if (DEFAULT_WEIGHTS[providerId] !== undefined) {
    return DEFAULT_WEIGHTS[providerId]
  }

  // Try prefix match (e.g., local-markdown:notes → local-markdown)
  for (const [key, weight] of Object.entries(DEFAULT_WEIGHTS)) {
    if (providerId.startsWith(`${key}:`)) {
      return weight
    }
  }

  return 0.5
}

/**
 * SwarmCoordinator — orchestrates query classification, provider selection,
 * parallel execution, and result fusion.
 *
 * Implements ISwarmCoordinator to serve the CLI command and agent tool.
 */
export class SwarmCoordinator implements ISwarmCoordinator {
  private readonly config: SwarmConfig
  private readonly graph: SwarmGraph
  private healthCache: Map<string, boolean> = new Map()
  private readonly providers: IMemoryProvider[]
  private totalQueries = 0

  constructor(providers: IMemoryProvider[], config: SwarmConfig) {
    this.providers = providers
    this.config = config
    this.graph = new SwarmGraph(providers, {
      timeoutMs: config.performance.maxQueryLatencyMs,
    })

    // Initialize health cache — assume all healthy until checked
    for (const p of providers) {
      this.healthCache.set(p.id, true)
    }
  }

  /**
   * Execute a swarm query: classify → select providers → execute in parallel → fuse results.
   */
  public async execute(request: QueryRequest): Promise<SwarmQueryResult> {
    const start = Date.now()

    // 1. Classify query type
    const queryType = request.type ?? classifyQuery(request.query)

    // 2. Select active providers based on query type, excluding unhealthy ones
    const healthyIds = this.providers
      .filter((p) => this.healthCache.get(p.id) !== false)
      .map((p) => p.id)
    const activeIds = selectProviders(queryType, healthyIds)

    // 3. Estimate total cost
    let costCents = 0
    for (const id of activeIds) {
      const provider = this.providers.find((p) => p.id === id)
      if (provider) {
        costCents += provider.estimateCost(request).estimatedCostCents
      }
    }

    // 4. Execute via SwarmGraph (parallel with timeout)
    const resultSets = await this.graph.execute(request, activeIds)

    // 5. Build provider weights map
    const weights = new Map<string, number>()
    for (const id of activeIds) {
      weights.set(id, resolveWeight(id))
    }

    // 6. Fuse results via RRF merger
    const maxResults = request.maxResults ?? this.config.routing.defaultMaxResults
    const merged = mergeResults(resultSets, weights, {
      K: this.config.routing.rrfK,
      maxResults,
    })

    // 7. Collect execution metadata from graph
    const graphMeta = this.graph.getLastExecutionMeta()
    const providerMeta = graphMeta?.providers ?? {}

    this.totalQueries++

    return {
      meta: {
        costCents,
        providers: providerMeta,
        queryType,
        totalLatencyMs: Date.now() - start,
      },
      results: merged,
    }
  }

  /**
   * Get info about all registered providers and their cached health status.
   */
  public getActiveProviders(): ProviderInfo[] {
    return this.providers.map((p) => ({
      capabilities: p.capabilities,
      healthy: this.healthCache.get(p.id) ?? true,
      id: p.id,
      type: p.type,
    }))
  }

  /**
   * Get a presentation-oriented summary of the swarm state.
   */
  public getSummary(): SwarmSummary {
    const providerInfos: ProviderInfo[] = this.providers.map((p) => ({
      capabilities: p.capabilities,
      healthy: this.healthCache.get(p.id) ?? true,
      id: p.id,
      type: p.type,
    }))

    const activeCount = providerInfos.filter((p) => p.healthy).length
    const avgLatencyMs = this.providers.length > 0
      ? this.providers.reduce((sum, p) => sum + p.capabilities.avgLatencyMs, 0) / this.providers.length
      : 0

    return {
      activeCount,
      avgLatencyMs,
      learningStatus: 'cold-start',
      monthlyBudgetCents: this.config.budget?.globalMonthlyCapCents ?? 0,
      monthlySpendCents: 0,
      providers: providerInfos,
      totalCount: this.providers.length,
      totalQueries: this.totalQueries,
    }
  }

  /**
   * Run health checks on all providers and update the cache.
   */
  public async refreshHealth(): Promise<ProviderInfo[]> {
    const results = await Promise.all(
      this.providers.map(async (p) => {
        const health = await p.healthCheck()
        this.healthCache.set(p.id, health.available)

        return {
          capabilities: p.capabilities,
          healthy: health.available,
          id: p.id,
          type: p.type,
        }
      })
    )

    return results
  }
}
