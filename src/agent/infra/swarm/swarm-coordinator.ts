import type {QueryRequest} from '../../core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../core/interfaces/i-memory-provider.js'
import type {
  ISwarmCoordinator,
  ProviderInfo,
  ProviderQueryMeta,
  SwarmQueryResult,
  SwarmStoreRequest,
  SwarmStoreResult,
  SwarmSummary,
} from '../../core/interfaces/i-swarm-coordinator.js'
import type {SwarmConfig} from './config/swarm-config-schema.js'

import {SwarmGraph} from './swarm-graph.js'
import {mergeResults} from './swarm-merger.js'
import {classifyQuery, selectProviders} from './swarm-router.js'
import {classifyWrite, selectWriteTarget} from './swarm-write-router.js'

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
 * Expand generic provider names in enrichment edges to concrete provider IDs,
 * then deduplicate and drop self-edges and cycles.
 *
 * Config edges may use "local-markdown" as a shorthand, but actual providers
 * are registered as "local-markdown:notes", "local-markdown:docs", etc.
 * This function expands each generic endpoint to all matching concrete IDs,
 * removes duplicates and self-edges, and detects/drops cycles.
 */
function expandEnrichmentEdges(
  configEdges: Array<{from: string; to: string}>,
  providerIds: string[]
): Array<{from: string; to: string}> {
  // 1. Expand generic endpoints to concrete IDs
  const seen = new Set<string>()
  const expanded: Array<{from: string; to: string}> = []

  for (const edge of configEdges) {
    const fromIds = resolveEndpoint(edge.from, providerIds)
    const toIds = resolveEndpoint(edge.to, providerIds)

    for (const from of fromIds) {
      for (const to of toIds) {
        // Drop self-edges
        if (from === to) continue

        // Deduplicate
        const key = `${from}->${to}`
        if (seen.has(key)) continue
        seen.add(key)

        expanded.push({from, to})
      }
    }
  }

  // 2. Drop all edges if the expanded graph has cycles
  if (hasCycleInEdges(expanded)) {
    return []
  }

  return expanded
}

/**
 * Detect cycles in an edge list using DFS.
 */
function hasCycleInEdges(edges: Array<{from: string; to: string}>): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = adjacency.get(edge.from) ?? []
    existing.push(edge.to)
    adjacency.set(edge.from, existing)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true
    if (visited.has(node)) return false
    visited.add(node)
    inStack.add(node)
    for (const neighbor of adjacency.get(node) ?? []) {
      if (dfs(neighbor)) return true
    }

    inStack.delete(node)

    return false
  }

  const allNodes = new Set([...edges.map((e) => e.from), ...edges.map((e) => e.to)])
  for (const node of allNodes) {
    if (dfs(node)) return true
  }

  return false
}

/**
 * Resolve a config endpoint to one or more concrete provider IDs.
 * Prefers prefix expansion over exact match so "local-markdown" expands to
 * concrete folder IDs rather than staying generic.
 */
function resolveEndpoint(endpoint: string, providerIds: string[]): string[] {
  // Prefer prefix expansion: "local-markdown" → ["local-markdown:notes", "local-markdown:docs"]
  const prefixMatches = providerIds.filter((id) => id.startsWith(`${endpoint}:`))
  if (prefixMatches.length > 0) return prefixMatches

  // Exact match (for providers without sub-IDs like "obsidian", "byterover")
  if (providerIds.includes(endpoint)) return [endpoint]

  // No match — return as-is (will be a no-op in the graph, but doesn't crash)
  return [endpoint]
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

    // Wire enrichment edges from config into the graph engine.
    // Expand generic provider names (e.g. "local-markdown") to concrete IDs
    // (e.g. "local-markdown:notes", "local-markdown:docs") so the graph can match them.
    const configEdges = config.enrichment?.edges ?? []
    if (configEdges.length > 0) {
      const providerIds = providers.map((p) => p.id)
      const expanded = expandEnrichmentEdges(configEdges, providerIds)
      this.graph.setEnrichmentEdges(expanded)
    }

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
      minRRFScore: this.config.routing.minRrfScore,
      rrfGapRatio: this.config.routing.rrfGapRatio,
    })

    // 7. Collect execution metadata from graph
    const graphMeta = this.graph.getLastExecutionMeta()
    const providerMeta: Record<string, ProviderQueryMeta> = {...graphMeta?.providers}

    // 8. Record excluded providers (available but not selected by the routing matrix).
    // Note: healthCache.get() returns undefined for unchecked providers, which is
    // intentionally treated as healthy (!== false) — providers start healthy until proven otherwise.
    const activeSet = new Set(activeIds)
    for (const p of this.providers) {
      if (!activeSet.has(p.id) && !providerMeta[p.id]) {
        const healthy = this.healthCache.get(p.id) !== false
        providerMeta[p.id] = {
          excludeReason: healthy ? `not in selection matrix for ${queryType}` : 'unhealthy',
          latencyMs: 0,
          resultCount: 0,
          selected: false,
        }
      }
    }

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

  /**
   * Store knowledge in the best writable provider.
   *
   * Routing:
   * 1. If request.provider is set → use that provider (verify writable + healthy)
   * 2. If request.contentType is set → use it as write type (skip classification)
   * 3. Otherwise → classifyWrite(content) → selectWriteTarget()
   */
  public async store(request: SwarmStoreRequest): Promise<SwarmStoreResult> {
    const start = Date.now()

    let target: IMemoryProvider

    if (request.provider) {
      // Explicit provider target
      const provider = this.providers.find((p) => p.id === request.provider)
      if (!provider) {
        return {error: `Provider '${request.provider}' not found`, id: '', latencyMs: 0, provider: request.provider, success: false}
      }

      if (!provider.capabilities.writeSupported) {
        return {error: `Provider '${request.provider}' does not support writes`, id: '', latencyMs: 0, provider: request.provider, success: false}
      }

      if (this.healthCache.get(provider.id) === false) {
        return {error: `Provider '${request.provider}' is not healthy`, id: '', latencyMs: 0, provider: request.provider, success: false}
      }

      target = provider
    } else {
      // Auto-route: classify content type, then select target
      const writeType = request.contentType ?? classifyWrite(request.content)
      target = selectWriteTarget(writeType, this.providers, this.healthCache)
    }

    try {
      const result = await target.store({
        content: request.content,
        metadata: {
          source: 'swarm-curate',
          timestamp: Date.now(),
        },
      })

      return {
        id: result.id,
        latencyMs: Date.now() - start,
        provider: target.id,
        success: result.success,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        id: '',
        latencyMs: Date.now() - start,
        provider: target.id,
        success: false,
      }
    }
  }
}
