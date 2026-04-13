import MiniSearch from 'minisearch'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'

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

import {applyGapRatio, POST_EXPANSION_GAP_RATIO, searchWithPrecision} from '../search-precision.js'

/** Wikilink decay factor for graph-expanded results */
const WIKILINK_DECAY = 0.7

/** Default patterns to ignore when scanning the vault */
const DEFAULT_IGNORE = new Set(['.git', '.obsidian', '.trash', 'templates'])

/**
 * Options for the Obsidian adapter.
 */
export interface ObsidianAdapterOptions {
  /** Additional folder names to ignore when scanning the vault */
  ignorePatterns?: string[]
  /** Whether to rescan files on each query (default: true). When false, the index is built once and frozen. */
  watchForChanges?: boolean
}

/**
 * Extract `[[target]]` and `[[target|alias]]` wikilinks from markdown content.
 */
function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match: null | RegExpExecArray
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }

  return links
}

/**
 * Recursively find all .md files in a directory, skipping ignored folders.
 */
type ScannedMarkdownFile = {
  fullPath: string
  relativePath: string
  signature: string
}

function findMarkdownFiles(dirPath: string, basePath: string, ignoreSet: Set<string>): ScannedMarkdownFile[] {
  const results: ScannedMarkdownFile[] = []

  try {
    const entries = readdirSync(dirPath, {withFileTypes: true})
    for (const entry of entries) {
      if (ignoreSet.has(entry.name)) continue

      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath, basePath, ignoreSet))
      } else if (entry.name.endsWith('.md')) {
        const stats = statSync(fullPath)
        results.push({
          fullPath,
          relativePath: relative(basePath, fullPath),
          signature: `${stats.mtimeMs}:${stats.size}`,
        })
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return results
}

function buildIndexSignature(files: ScannedMarkdownFile[]): string {
  return files
    .map((file) => `${file.relativePath}:${file.signature}`)
    .sort()
    .join('|')
}

type IndexedDoc = {
  content: string
  id: number
  path: string
  title: string
  wikilinks: string[]
}

/**
 * Obsidian vault adapter — indexes .md files via MiniSearch,
 * follows [[wikilinks]] one hop for graph expansion.
 *
 * Read-only by default (does not modify the user's vault).
 */
export class ObsidianAdapter implements IMemoryProvider {
  public readonly capabilities: ProviderCapabilities = {
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
  public readonly id = 'obsidian'
  public readonly type = 'obsidian' as const
  private documents: IndexedDoc[] = []
  private readonly ignoreSet: Set<string>
  private index?: MiniSearch<IndexedDoc>
  private indexSignature?: string
  private pathToDoc = new Map<string, IndexedDoc>()
  private readonly watchForChanges: boolean

  constructor(private readonly vaultPath: string, options?: ObsidianAdapterOptions) {
    this.ignoreSet = new Set([...(options?.ignorePatterns ?? []), ...DEFAULT_IGNORE])
    this.watchForChanges = options?.watchForChanges ?? true
  }

  public async delete(_id: string): Promise<void> {
    throw new Error('Obsidian vault is read-only.')
  }

  public estimateCost(_request: QueryRequest): CostEstimate {
    return {
      estimatedCostCents: 0,
      estimatedLatencyMs: this.capabilities.avgLatencyMs,
      estimatedTokens: 0,
    }
  }

  public async healthCheck(): Promise<HealthStatus> {
    return {available: existsSync(this.vaultPath)}
  }

  public async query(request: QueryRequest): Promise<QueryResult[]> {
    this.ensureIndex()

    const maxResults = request.maxResults ?? 10

    // T1/T2/T3: Precision-filtered search (stop words, AND-first, score floor, gap ratio)
    const precisionResults = searchWithPrecision(this.index!, request.query, {maxResults})
    if (precisionResults.length === 0) return []

    // Collect direct matches
    const resultMap = new Map<string, {doc: IndexedDoc; matchType: 'graph' | 'keyword'; score: number}>()

    for (const pr of precisionResults) {
      const doc = this.documents[pr.id as number]
      if (!doc) continue
      resultMap.set(doc.path, {doc, matchType: 'keyword', score: pr.normalizedScore})
    }

    // Expand wikilinks one hop from direct matches
    for (const [, entry] of resultMap) {
      for (const linkTarget of entry.doc.wikilinks) {
        const candidates = [
          `${linkTarget}.md`,
          linkTarget,
          ...[...this.pathToDoc.keys()].filter((p) =>
            p.toLowerCase().endsWith(`${linkTarget.toLowerCase()}.md`) ||
            p.toLowerCase() === linkTarget.toLowerCase()
          ),
        ]

        for (const candidate of candidates) {
          const linkedDoc = this.pathToDoc.get(candidate)
          if (linkedDoc && !resultMap.has(linkedDoc.path)) {
            resultMap.set(linkedDoc.path, {
              doc: linkedDoc,
              matchType: 'graph',
              score: entry.score * WIKILINK_DECAY,
            })

            break
          }
        }
      }
    }

    // Second gap-ratio pass on combined direct + expanded results (T3 only)
    const combined = [...resultMap.entries()].map(([path, entry]) => ({
      doc: entry.doc,
      matchType: entry.matchType,
      normalizedScore: entry.score,
      path,
    }))
    const gapFiltered = applyGapRatio(
      combined.map((c) => ({id: c.path, normalizedScore: c.normalizedScore, queryTerms: [], rawScore: 0})),
      POST_EXPANSION_GAP_RATIO,
    )
    const keptPaths = new Set(gapFiltered.map((r) => r.id))

    const sorted = combined
      .filter((c) => keptPaths.has(c.path))
      .sort((a, b) => b.normalizedScore - a.normalizedScore)
      .slice(0, maxResults)

    return sorted.map((entry, index) => ({
      content: entry.doc.content.slice(0, 500),
      id: `obsidian-${index}`,
      metadata: {
        matchType: entry.matchType,
        path: entry.path,
        source: entry.path,
      },
      provider: 'obsidian',
      score: entry.normalizedScore,
    }))
  }

  public async store(_entry: MemoryEntry): Promise<StoreResult> {
    throw new Error('Obsidian vault is read-only.')
  }

  public async update(_id: string, _entry: Partial<MemoryEntry>): Promise<void> {
    throw new Error('Obsidian vault is read-only.')
  }

  private ensureIndex(): void {
    // When watchForChanges is false, reuse the existing index after initial build
    if (this.index && !this.watchForChanges) {
      return
    }

    const files = findMarkdownFiles(this.vaultPath, this.vaultPath, this.ignoreSet)
    const nextSignature = buildIndexSignature(files)
    if (this.index && this.indexSignature === nextSignature) {
      return
    }

    this.documents = files.map((file, index) => {
      const content = readFileSync(file.fullPath, 'utf8')
      const titleMatch = content.match(/^#\s+(.+)$/m)

      return {
        content,
        id: index,
        path: file.relativePath,
        title: titleMatch?.[1] ?? file.relativePath,
        wikilinks: extractWikilinks(content),
      }
    })

    this.index = new MiniSearch<IndexedDoc>({
      fields: ['title', 'content'],
      storeFields: ['title', 'path'],
    })
    this.index.addAll(this.documents)

    this.pathToDoc.clear()
    for (const doc of this.documents) {
      this.pathToDoc.set(doc.path, doc)
    }

    this.indexSignature = nextSignature
  }
}
