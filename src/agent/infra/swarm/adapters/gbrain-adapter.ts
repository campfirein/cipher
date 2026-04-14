import {execFile, execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

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
 * Options for the GBrain adapter.
 */
export interface GBrainAdapterOptions {
  /** Explicit path to the gbrain binary or .ts entrypoint. Auto-resolved if omitted. */
  gbrainBinPath?: string
  /** Path to the brain repo (also used to find local gbrain installation) */
  repoPath: string
  /** Search mode: hybrid (default), keyword, or vector */
  searchMode: 'hybrid' | 'keyword' | 'vector'
}

/**
 * Executor function type for running gbrain CLI operations.
 * Abstracted for testability — tests inject a mock, production uses execGbrain().
 */
export type GBrainExecutor = (operation: string, params: Record<string, unknown>) => Promise<unknown>

/**
 * Default timeout for gbrain subprocess calls.
 * PGLite WASM startup via Node execFile is significantly slower than interactive shell
 * (cold-start ~60s for writes vs <1s for reads). 120s covers worst-case write operations.
 */
const EXEC_TIMEOUT_MS = 120_000

/**
 * Resolve the gbrain binary path.
 *
 * Search order:
 * 1. Explicit `gbrainBinPath` from options
 * 2. `gbrain` in PATH (globally installed)
 * 3. `src/cli.ts` in `repoPath` (local Bun clone — repoPath IS the source checkout)
 * 4. `src/cli.ts` in common workspace siblings (../gbrain relative to cwd)
 */
export function resolveGBrainBin(options: GBrainAdapterOptions): {argsPrefix: string[]; command: string} {
  // 1. Explicit path
  if (options.gbrainBinPath) {
    if (options.gbrainBinPath.endsWith('.ts')) {
      return {argsPrefix: ['run', options.gbrainBinPath], command: 'bun'}
    }

    return {argsPrefix: [], command: options.gbrainBinPath}
  }

  // 2. Check PATH (sync probe — runs lazily on first executor access, not at construction)
  try {
    execFileSync('gbrain', ['--version'], {encoding: 'utf8', stdio: 'pipe', timeout: 5000})

    return {argsPrefix: [], command: 'gbrain'}
  } catch {
    // Not in PATH — continue to fallback
  }

  // 3. Local clone at repoPath
  const localScript = join(options.repoPath, 'src', 'cli.ts')
  if (existsSync(localScript)) {
    return {argsPrefix: ['run', localScript], command: 'bun'}
  }

  // 4. Common workspace siblings — look for ../gbrain relative to cwd
  const workspaceSibling = join(process.cwd(), '..', 'gbrain', 'src', 'cli.ts')
  if (existsSync(workspaceSibling)) {
    return {argsPrefix: ['run', workspaceSibling], command: 'bun'}
  }

  // 5. Fallback — try 'gbrain' anyway (will fail with ENOENT at runtime)
  return {argsPrefix: [], command: 'gbrain'}
}

/**
 * Execute a gbrain CLI operation via subprocess.
 * Runs: <command> [argsPrefix...] call <operation> '<json params>'
 */
function createDefaultExecutor(resolved: {argsPrefix: string[]; command: string}): GBrainExecutor {
  return (operation: string, params: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const jsonArgs = JSON.stringify(params)
    const args = [...resolved.argsPrefix, 'call', operation, jsonArgs]

    execFile(resolved.command, args, {encoding: 'utf8', timeout: EXEC_TIMEOUT_MS}, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || error.message
        reject(new Error(`gbrain ${operation} failed: ${message}`))

        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`gbrain ${operation} returned invalid JSON: ${stdout.slice(0, 200)}`))
      }
    })
  })
}

/**
 * Derive a slug from content for gbrain page creation.
 * Extracts title from first heading or uses timestamp fallback.
 */
function deriveSlug(content: string): string {
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? `note-${Date.now()}`

  const slug = title
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return `concept/${slug || `note-${Date.now()}`}`
}

/**
 * GBrain adapter — queries a GBrain knowledge brain via CLI subprocess.
 *
 * Supports three search modes:
 * - hybrid (default): vector + keyword + RRF + multi-query expansion
 * - keyword: full-text search only (no API key needed)
 * - vector: vector search without expansion
 */
export class GBrainAdapter implements IMemoryProvider {
  public readonly capabilities: ProviderCapabilities = {
    avgLatencyMs: 300,
    graphTraversal: false,
    keywordSearch: true,
    localOnly: false,
    maxTokensPerQuery: 10_000,
    semanticSearch: true,
    temporalQuery: true,
    userModeling: false,
    writeSupported: true,
  }
  public readonly id = 'gbrain'
  public readonly type = 'gbrain' as const
  private cachedExecutor?: GBrainExecutor
  private readonly injectedExecutor?: GBrainExecutor
  private readonly options: GBrainAdapterOptions
  private readonly repoPath: string
  private readonly searchMode: 'hybrid' | 'keyword' | 'vector'

  constructor(options: GBrainAdapterOptions, executor?: GBrainExecutor) {
    this.repoPath = options.repoPath
    this.searchMode = options.searchMode
    this.options = options
    this.injectedExecutor = executor
  }

  private get executor(): GBrainExecutor {
    if (this.injectedExecutor) return this.injectedExecutor
    this.cachedExecutor ??= createDefaultExecutor(resolveGBrainBin(this.options))
    return this.cachedExecutor
  }

  public async delete(id: string): Promise<void> {
    await this.executor('delete_page', {slug: id})
  }

  public estimateCost(_request: QueryRequest): CostEstimate {
    // Keyword mode is free (no embedding API call)
    // Hybrid/vector use OpenAI embedding (~$0.001 per query)
    const costCents = this.searchMode === 'keyword' ? 0 : 0.1

    return {
      estimatedCostCents: costCents,
      estimatedLatencyMs: this.capabilities.avgLatencyMs,
      estimatedTokens: 0,
    }
  }

  public async healthCheck(): Promise<HealthStatus> {
    if (!existsSync(this.repoPath)) {
      return {
        available: false,
        error: `GBrain repo not found at ${this.repoPath}`,
      }
    }

    try {
      await this.executor('get_stats', {})

      return {available: true}
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  public async query(request: QueryRequest): Promise<QueryResult[]> {
    const limit = request.maxResults ?? 10

    let results: GBrainSearchResult[]

    switch (this.searchMode) {
      case 'keyword': {
        results = await this.executor('search', {limit, query: request.query}) as GBrainSearchResult[]

        break
      }

      case 'vector': {
        results = await this.executor('query', {expand: false, limit, query: request.query}) as GBrainSearchResult[]

        break
      }

      default: {
        // hybrid
        results = await this.executor('query', {expand: true, limit, query: request.query}) as GBrainSearchResult[]
      }
    }

    return results.map((r) => ({
      content: r.chunk_text,
      id: r.slug,
      metadata: {
        matchType: this.searchMode === 'keyword' ? 'keyword' as const : 'semantic' as const,
        path: r.slug,
        source: r.slug,
      },
      provider: 'gbrain',
      providerType: 'gbrain',
      score: this.normalizeScore(r.score),
    }))
  }

  public async store(entry: MemoryEntry): Promise<StoreResult> {
    const slug = deriveSlug(entry.content)
    const content = `---\ntype: concept\ntitle: ${entry.content.match(/^#\s+(.+)$/m)?.[1] ?? slug}\n---\n${entry.content}`

    await this.executor('put_page', {content, slug})

    return {id: slug, provider: 'gbrain', success: true}
  }

  public async update(id: string, entry: Partial<MemoryEntry>): Promise<void> {
    if (!entry.content) return
    const content = `---\ntype: concept\ntitle: ${entry.content.match(/^#\s+(.+)$/m)?.[1] ?? id}\n---\n${entry.content}`
    await this.executor('put_page', {content, slug: id})
  }

  /**
   * Normalize scores to 0-1 range.
   * - Hybrid/RRF scores are already in 0-1 range (sum of 1/(60+rank))
   * - Keyword ts_rank scores can exceed 1 — normalize with score/(1+score)
   */
  private normalizeScore(score: number): number {
    if (this.searchMode === 'keyword' && score > 1) {
      return score / (1 + score)
    }

    return Math.min(score, 1)
  }
}

/**
 * GBrain search result from CLI JSON output.
 */
type GBrainSearchResult = {
  chunk_source: 'compiled_truth' | 'timeline'
  chunk_text: string
  page_id: number
  score: number
  slug: string
  stale: boolean
  title: string
  type: string
}
