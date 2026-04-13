import type {QueryRequest, QueryResult} from '../../core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../core/interfaces/i-memory-provider.js'
import type {ProviderQueryMeta} from '../../core/interfaces/i-swarm-coordinator.js'

/**
 * Per-provider execution metadata from the last query.
 */
export type GraphExecutionMeta = {
  providers: Record<string, ProviderQueryMeta>
  totalLatencyMs: number
}

/**
 * Options for the swarm graph.
 */
export type SwarmGraphOptions = {
  /** Timeout per provider in milliseconds (default: 2000) */
  timeoutMs?: number
}

/**
 * An enrichment edge: provider `from` feeds results to provider `to`.
 */
export type EnrichmentEdge = {
  from: string
  to: string
}

/**
 * Execute a query against a provider with a timeout.
 * Returns empty results if the provider times out or throws.
 */
async function queryWithTimeout(
  provider: IMemoryProvider,
  request: QueryRequest,
  timeoutMs: number
): Promise<{latencyMs: number; results: QueryResult[]}> {
  const start = Date.now()

  try {
    const result = await Promise.race([
      provider.query(request),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error(`Provider ${provider.id} timed out after ${timeoutMs}ms`)) }, timeoutMs)
      }),
    ])

    return {latencyMs: Date.now() - start, results: result}
  } catch {
    return {latencyMs: Date.now() - start, results: []}
  }
}

/**
 * Build enrichment data by merging results from multiple predecessor providers.
 */
function buildEnrichment(allResults: QueryResult[]): QueryRequest['enrichment'] {
  const keywords = allResults
    .map((r) => r.content)
    .filter((c) => c.length > 0)

  return {keywords}
}

/**
 * Swarm Graph — executes providers in topological levels with enrichment chains.
 *
 * Level 0: providers with no incoming enrichment edges (run in parallel).
 * Level 1+: providers that depend on earlier-level results (run after predecessors complete).
 *
 * Supports arbitrary DAG depth (A→B→C) and fan-in (A→C, B→C).
 * Fan-in nodes receive merged enrichment from ALL predecessors.
 */
export class SwarmGraph {
  private edges: EnrichmentEdge[] = []
  private lastMeta?: GraphExecutionMeta
  private readonly providerMap: Map<string, IMemoryProvider>
  private readonly timeoutMs: number

  constructor(providers: IMemoryProvider[], options?: SwarmGraphOptions) {
    this.providerMap = new Map(providers.map((p) => [p.id, p]))
    this.timeoutMs = options?.timeoutMs ?? 2000
  }

  /**
   * Execute a query across the specified active providers.
   * Providers are grouped into topological levels based on enrichment edges.
   * Level-0 runs in parallel; level-1+ providers receive enrichment from predecessors.
   */
  public async execute(
    request: QueryRequest,
    activeProviderIds: string[]
  ): Promise<Map<string, QueryResult[]>> {
    const start = Date.now()
    const results = new Map<string, QueryResult[]>()
    const providerMeta: Record<string, ProviderQueryMeta> = {}
    const activeSet = new Set(activeProviderIds)

    // Build execution levels
    const {levels, predecessors} = this.buildExecutionLevels(activeSet)

    // Execute each level sequentially; providers within a level run in parallel
    for (const level of levels) {
      const executions = level
        .map((id) => {
          const provider = this.providerMap.get(id)
          if (!provider) return

          // Build enriched request by merging results from ALL predecessors
          let enrichedRequest = request
          const predIds = predecessors.get(id)
          if (predIds && predIds.length > 0) {
            const allPredResults: QueryResult[] = []
            for (const predId of predIds) {
              const predResults = results.get(predId)
              if (predResults) {
                allPredResults.push(...predResults)
              }
            }

            if (allPredResults.length > 0) {
              enrichedRequest = {
                ...request,
                enrichment: buildEnrichment(allPredResults),
              }
            }
          }

          return queryWithTimeout(provider, enrichedRequest, this.timeoutMs).then((outcome) => {
            results.set(id, outcome.results)
            const enrichment = predIds && predIds.length > 0 ? buildEnrichment(
              predIds.flatMap((pid) => results.get(pid) ?? [])
            ) : undefined
            providerMeta[id] = {
              enrichedBy: predIds && predIds.length > 0 ? predIds.join(',') : undefined,
              enrichmentKeywords: enrichment?.keywords?.slice(0, 10),
              latencyMs: outcome.latencyMs,
              resultCount: outcome.results.length,
              selected: true,
            }
          })
        })
        .filter(Boolean)

      // eslint-disable-next-line no-await-in-loop -- levels must run sequentially
      await Promise.all(executions)
    }

    this.lastMeta = {
      providers: providerMeta,
      totalLatencyMs: Date.now() - start,
    }

    return results
  }

  /**
   * Get execution metadata from the last query.
   */
  public getLastExecutionMeta(): GraphExecutionMeta | undefined {
    return this.lastMeta
  }

  /**
   * Configure enrichment edges between providers.
   * An edge { from: 'A', to: 'B' } means B runs after A and receives A's results.
   */
  public setEnrichmentEdges(edges: EnrichmentEdge[]): void {
    this.edges = edges
  }

  /**
   * Compute topological execution levels using Kahn's algorithm.
   *
   * Supports arbitrary DAG depth (A→B→C→...) and fan-in (A→C, B→C).
   * Returns levels grouped for parallel execution and a map of
   * provider ID → ALL predecessor IDs that feed it enrichment.
   */
  private buildExecutionLevels(activeSet: Set<string>): {
    levels: string[][]
    predecessors: Map<string, string[]>
  } {
    // Filter edges to only active providers on both sides
    const activeEdges = this.edges.filter(
      (e) => activeSet.has(e.from) && activeSet.has(e.to)
    )

    // Build the predecessors map (to → [from1, from2, ...])
    const predecessors = new Map<string, string[]>()
    for (const edge of activeEdges) {
      const existing = predecessors.get(edge.to) ?? []
      existing.push(edge.from)
      predecessors.set(edge.to, existing)
    }

    // Build in-degree counts and adjacency list
    const inDegree = new Map<string, number>()
    const successors = new Map<string, string[]>()
    for (const id of activeSet) {
      inDegree.set(id, 0)
      successors.set(id, [])
    }

    for (const edge of activeEdges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
      successors.get(edge.from)!.push(edge.to)
    }

    // Kahn's algorithm: peel off nodes with in-degree 0, level by level
    const levels: string[][] = []
    let currentLevel = [...activeSet].filter((id) => inDegree.get(id) === 0)

    while (currentLevel.length > 0) {
      levels.push(currentLevel)
      const nextLevel: string[] = []

      for (const id of currentLevel) {
        for (const succ of successors.get(id) ?? []) {
          const newDegree = (inDegree.get(succ) ?? 1) - 1
          inDegree.set(succ, newDegree)
          if (newDegree === 0) {
            nextLevel.push(succ)
          }
        }
      }

      currentLevel = nextLevel
    }

    return {levels, predecessors}
  }
}
