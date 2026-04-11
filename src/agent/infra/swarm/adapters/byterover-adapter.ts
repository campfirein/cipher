import type {
  CostEstimate,
  HealthStatus,
  MemoryEntry,
  ProviderCapabilities,
  QueryRequest,
  QueryResult,
  StoreResult,
} from '../../../core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../../core/interfaces/i-memory-provider.js'

/**
 * Minimal interface for the search service dependency.
 * Matches SearchKnowledgeService.search() signature.
 */
export interface SearchService {
  search(query: string, options?: {limit?: number; scope?: string}): Promise<{
    results: Array<{excerpt: string; path: string; score: number; title: string}>
    totalFound: number
  }>
}

/**
 * ByteRover adapter — wraps the existing SearchKnowledgeService
 * behind the IMemoryProvider interface.
 *
 * Always active (built-in). Uses BM25 keyword search over the context-tree.
 */
export class ByteRoverAdapter implements IMemoryProvider {
  public readonly capabilities: ProviderCapabilities = {
    avgLatencyMs: 50,
    graphTraversal: false,
    keywordSearch: true,
    localOnly: true,
    maxTokensPerQuery: 8000,
    semanticSearch: false,
    temporalQuery: false,
    userModeling: false,
    writeSupported: false,
  }
public readonly id = 'byterover'
  public readonly type = 'byterover' as const

  constructor(private readonly searchService: SearchService) {}

  public async delete(_id: string): Promise<void> {
    throw new Error('ByteRover delete not implemented — use curate tool directly.')
  }

  public estimateCost(_request: QueryRequest): CostEstimate {
    return {
      estimatedCostCents: 0,
      estimatedLatencyMs: this.capabilities.avgLatencyMs,
      estimatedTokens: 0,
    }
  }

  public async healthCheck(): Promise<HealthStatus> {
    return {available: true}
  }

  public async query(request: QueryRequest): Promise<QueryResult[]> {
    const searchResult = await this.searchService.search(request.query, {
      limit: request.maxResults,
      scope: request.scope,
    })

    return searchResult.results.map((result, index) => ({
      content: result.excerpt,
      id: `brv-${index}`,
      metadata: {
        matchType: 'keyword' as const,
        path: result.path,
        source: result.path,
      },
      provider: 'byterover',
      score: result.score,
    }))
  }

  public async store(_entry: MemoryEntry): Promise<StoreResult> {
    throw new Error('ByteRover store not implemented — use curate tool directly.')
  }

  public async update(_id: string, _entry: Partial<MemoryEntry>): Promise<void> {
    throw new Error('ByteRover update not implemented — use curate tool directly.')
  }
}
