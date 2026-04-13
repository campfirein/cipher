import MiniSearch from 'minisearch'
import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
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

import {ADAPTER_CONTENT_LIMIT, applyGapRatio, POST_EXPANSION_GAP_RATIO, searchWithPrecision} from '../search-precision.js'

/** Wikilink decay factor for graph-expanded results */
const WIKILINK_DECAY = 0.7

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
 * Recursively find all .md files in a directory.
 */
type ScannedMarkdownFile = {
  fullPath: string
  relativePath: string
  signature: string
}

function findMarkdownFiles(dirPath: string, basePath: string): ScannedMarkdownFile[] {
  const results: ScannedMarkdownFile[] = []

  try {
    const entries = readdirSync(dirPath, {withFileTypes: true})
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath, basePath))
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

/**
 * Derive a filename from note content (first heading or fallback).
 */
function deriveFilename(content: string): string {
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? `note-${Date.now()}`

  const slug = title
    .toLowerCase()
    .replaceAll(/[^\w-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return `${slug || `note-${Date.now()}`}.md`
}

function buildIndexSignature(files: ScannedMarkdownFile[]): string {
  return files
    .map((file) => `${file.relativePath}:${file.signature}`)
    .sort()
    .join('|')
}

function resolveUniqueFilename(folderPath: string, preferredFilename: string): string {
  const baseName = preferredFilename.replace(/\.md$/u, '')

  let suffix = 0
  while (true) {
    const candidate = suffix === 0 ? `${baseName}.md` : `${baseName}-${suffix}.md`
    if (!existsSync(join(folderPath, candidate))) {
      return candidate
    }

    suffix++
  }
}

type IndexedDoc = {
  content: string
  id: number
  path: string
  title: string
  wikilinks: string[]
}

/**
 * Options for LocalMarkdownAdapter behavior.
 */
export interface LocalMarkdownAdapterOptions {
  /** Whether to follow [[wikilinks]] for graph expansion (default: true) */
  followWikilinks?: boolean
  /** Whether the folder is read-only (default: false) */
  readOnly?: boolean
  /** Whether to rescan files on each query (default: true). When false, the index is built once and frozen. */
  watchForChanges?: boolean
}

/**
 * Local markdown folder adapter — indexes .md files via MiniSearch,
 * optionally follows [[wikilinks]] one hop, supports write unless read-only.
 *
 * Each folder instance has a unique id: `local-markdown:{name}`.
 */
export class LocalMarkdownAdapter implements IMemoryProvider {
  public readonly capabilities: ProviderCapabilities
  public readonly id: string
  public readonly type = 'local-markdown' as const
  private documents: IndexedDoc[] = []
  private readonly followWikilinks: boolean
  private index?: MiniSearch<IndexedDoc>
  private indexSignature?: string
  private pathToDoc = new Map<string, IndexedDoc>()
  private readonly readOnly: boolean
  private readonly watchForChanges: boolean

  constructor(
    private readonly folderPath: string,
    private readonly name: string,
    options?: LocalMarkdownAdapterOptions,
  ) {
    this.id = `local-markdown:${name}`
    this.readOnly = options?.readOnly ?? false
    this.followWikilinks = options?.followWikilinks ?? true
    this.watchForChanges = options?.watchForChanges ?? true
    this.capabilities = {
      avgLatencyMs: 80,
      graphTraversal: this.followWikilinks,
      keywordSearch: true,
      localOnly: true,
      maxTokensPerQuery: 6000,
      semanticSearch: false,
      temporalQuery: false,
      userModeling: false,
      writeSupported: !this.readOnly,
    }
  }

  public async delete(_id: string): Promise<void> {
    throw new Error('Local markdown delete not implemented.')
  }

  public estimateCost(_request: QueryRequest): CostEstimate {
    return {
      estimatedCostCents: 0,
      estimatedLatencyMs: this.capabilities.avgLatencyMs,
      estimatedTokens: 0,
    }
  }

  public async healthCheck(): Promise<HealthStatus> {
    return {available: existsSync(this.folderPath)}
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

    // Without wikilink expansion: return direct matches
    if (!this.followWikilinks) {
      const sorted = [...resultMap.values()].sort((a, b) => b.score - a.score).slice(0, maxResults)

      return sorted.map((entry, index) => ({
        content: entry.doc.content.slice(0, ADAPTER_CONTENT_LIMIT),
        id: `local-md-${this.name}-${index}`,
        metadata: {
          matchType: entry.matchType,
          path: entry.doc.path,
          source: entry.doc.path,
        },
        provider: this.id,
        providerType: 'local-markdown',
        score: entry.score,
      }))
    }

    // Expand wikilinks one hop from direct matches
    for (const [, entry] of resultMap) {
      for (const linkTarget of entry.doc.wikilinks) {
        const candidates = [
          `${linkTarget}.md`,
          linkTarget,
          ...[...this.pathToDoc.keys()].filter(
            (p) =>
              p.toLowerCase().endsWith(`${linkTarget.toLowerCase()}.md`) ||
              p.toLowerCase() === linkTarget.toLowerCase(),
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
      content: entry.doc.content.slice(0, ADAPTER_CONTENT_LIMIT),
      id: `local-md-${this.name}-${index}`,
      metadata: {
        matchType: entry.matchType,
        path: entry.path,
        source: entry.path,
      },
      provider: this.id,
      providerType: 'local-markdown',
      score: entry.normalizedScore,
    }))
  }

  public async store(entry: MemoryEntry): Promise<StoreResult> {
    if (this.readOnly) {
      throw new Error(`Local markdown folder '${this.name}' is read-only.`)
    }

    const filename = resolveUniqueFilename(this.folderPath, deriveFilename(entry.content))
    const filePath = join(this.folderPath, filename)
    writeFileSync(filePath, entry.content)

    // Invalidate index so next query picks up the new file
    this.index = undefined
    this.indexSignature = undefined

    return {id: filename, provider: this.id, success: true}
  }

  public async update(_id: string, _entry: Partial<MemoryEntry>): Promise<void> {
    throw new Error('Local markdown update not implemented.')
  }

  private ensureIndex(): void {
    // When watchForChanges is false, reuse the existing index after initial build
    if (this.index && !this.watchForChanges) {
      return
    }

    const files = findMarkdownFiles(this.folderPath, this.folderPath)
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
