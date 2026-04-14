import MiniSearch from 'minisearch'
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
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

import {searchWithPrecision} from '../search-precision.js'

/** Directories to scan for wiki pages */
const PAGE_DIRS = ['entities', 'concepts', 'syntheses', 'sources']

/** Score boost for fresh pages */
const FRESH_BOOST = 1.2

/** Score boost for entities/concepts over sources */
const KIND_BOOST: Record<string, number> = {
  concept: 1.3,
  entity: 1.4,
  source: 1,
  synthesis: 1.2,
}

interface DigestPage {
  claimCount: number
  freshnessLevel: string
  id: string
  kind: string
  lastTouchedAt: string
  path: string
  title: string
  topClaims: Array<{text: string}>
}

interface AgentDigest {
  pageCounts: Record<string, number>
  pages: DigestPage[]
}

interface IndexedDoc {
  content: string
  freshnessLevel: string
  id: number
  kind: string
  pageId: string
  path: string
  title: string
}

export interface MemoryWikiAdapterOptions {
  boostFresh?: boolean
  vaultPath: string
  writePageType?: 'concept' | 'entity'
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .trim()
    .replaceAll(/\s+/g, '_')
}

function buildIndexSignature(vaultPath: string): string {
  const digestPath = join(vaultPath, '.openclaw-wiki', 'cache', 'agent-digest.json')
  try {
    const stat = statSync(digestPath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return ''
  }
}

function extractContentSection(fullContent: string): string {
  // Extract content from openclaw:wiki:content markers (written by store())
  const wikiMarkerMatch = fullContent.match(/<!-- openclaw:wiki:content:start -->\n([\s\S]*?)<!-- openclaw:wiki:content:end -->/)
  if (wikiMarkerMatch) {
    return wikiMarkerMatch[1].trim()
  }

  // Extract from ```text code block (wiki source page format)
  const codeBlockMatch = fullContent.match(/```text\n([\s\S]*?)```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Fallback: strip frontmatter and return everything
  const withoutFrontmatter = fullContent.replace(/^---[\s\S]*?---\n*/, '')
  return withoutFrontmatter.trim()
}

export class MemoryWikiAdapter implements IMemoryProvider {
  public readonly capabilities: ProviderCapabilities = {
    avgLatencyMs: 60,
    graphTraversal: false,
    keywordSearch: true,
    localOnly: true,
    maxTokensPerQuery: 8000,
    semanticSearch: false,
    temporalQuery: false,
    userModeling: false,
    writeSupported: true,
  }
  public readonly id = 'memory-wiki'
  public readonly type = 'memory-wiki' as const
  private readonly boostFresh: boolean
  private digest: AgentDigest | null = null
  private documents: IndexedDoc[] = []
  private index: MiniSearch<IndexedDoc> | null = null
  private indexSignature = ''
  private readonly vaultPath: string
  private readonly writePageType: 'concept' | 'entity'

  constructor(options: MemoryWikiAdapterOptions) {
    this.vaultPath = options.vaultPath
    this.boostFresh = options.boostFresh ?? true
    this.writePageType = options.writePageType ?? 'concept'
  }

  public async delete(_id: string): Promise<void> {
    throw new Error('Memory Wiki pages should be managed via wiki_apply.')
  }

  public estimateCost(_request: QueryRequest): CostEstimate {
    return {estimatedCostCents: 0, estimatedLatencyMs: 60, estimatedTokens: 0}
  }

  public async healthCheck(): Promise<HealthStatus> {
    try {
      if (!existsSync(this.vaultPath)) {
        return {available: false, error: `Wiki vault not found at ${this.vaultPath}`}
      }

      return {available: true}
    } catch (error) {
      return {available: false, error: error instanceof Error ? error.message : String(error)}
    }
  }

  public async query(request: QueryRequest): Promise<QueryResult[]> {
    this.ensureIndex()

    if (!this.index) {
      return []
    }

    const maxResults = request.maxResults ?? 10
    const precisionResults = searchWithPrecision(this.index, request.query, {maxResults})

    if (precisionResults.length === 0) {
      return []
    }

    const mapped: QueryResult[] = []
    for (const pr of precisionResults) {
      const doc = this.documents[pr.id as number]
      if (!doc) continue

      let score = pr.normalizedScore

      // Freshness boost
      if (this.boostFresh && doc.freshnessLevel === 'fresh') {
        score *= FRESH_BOOST
      }

      // Kind boost
      score *= KIND_BOOST[doc.kind] ?? 1

      mapped.push({
        content: extractContentSection(doc.content).slice(0, 5000),
        id: doc.pageId,
        metadata: {
          matchType: 'keyword' as const,
          path: doc.path,
          source: doc.path,
        },
        provider: 'memory-wiki',
        providerType: 'memory-wiki' as const,
        score,
      })
    }

    return mapped.sort((a, b) => b.score - a.score).slice(0, maxResults)
  }

  public async store(entry: MemoryEntry): Promise<StoreResult> {
    const {content} = entry
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch?.[1] ?? content.slice(0, 60).trim()
    const slug = slugify(title)
    const pageType = this.writePageType
    const dir = pageType === 'entity' ? 'entities' : 'concepts'
    const dirPath = join(this.vaultPath, dir)
    mkdirSync(dirPath, {recursive: true})
    const now = new Date().toISOString()

    // Resolve unique filename
    const MAX_SUFFIX = 10_000
    let filename = `${slug}.md`
    let filePath = join(dirPath, filename)
    let suffix = 1
    while (existsSync(filePath) && suffix <= MAX_SUFFIX) {
      filename = `${slug}-${suffix}.md`
      filePath = join(dirPath, filename)
      suffix++
    }

    if (existsSync(filePath)) {
      filename = `${slug}-${Date.now()}.md`
      filePath = join(dirPath, filename)
    }

    const pageId = `${pageType}.swarm.${slug}`
    const pageContent = [
      '---',
      `pageType: ${pageType}`,
      `id: ${pageId}`,
      `title: "${title}"`,
      'status: active',
      `updatedAt: "${now}"`,
      'sourceType: swarm-curate',
      '---',
      '',
      '<!-- openclaw:wiki:content:start -->',
      content,
      '<!-- openclaw:wiki:content:end -->',
      '',
      '<!-- openclaw:human:start -->',
      '<!-- openclaw:human:end -->',
      '',
    ].join('\n')

    await writeFile(filePath, pageContent)

    // Invalidate index so next query picks up the new page
    this.index = null
    this.indexSignature = ''

    return {id: pageId, provider: 'memory-wiki', success: true}
  }

  public async update(_id: string, _entry: Partial<MemoryEntry>): Promise<void> {
    throw new Error('Memory Wiki pages should be managed via wiki_apply.')
  }

  private ensureIndex(): void {
    const nextSignature = buildIndexSignature(this.vaultPath)
    if (this.index && this.indexSignature === nextSignature) {
      return
    }

    this.digest = this.loadDigest()
    this.documents = this.scanPages()

    this.index = new MiniSearch<IndexedDoc>({
      fields: ['title', 'content'],
      idField: 'id',
      storeFields: ['title', 'path'],
    })
    this.index.addAll(this.documents)
    this.indexSignature = nextSignature
  }

  private loadDigest(): AgentDigest | null {
    const digestPath = join(this.vaultPath, '.openclaw-wiki', 'cache', 'agent-digest.json')
    try {
      return JSON.parse(readFileSync(digestPath, 'utf8')) as AgentDigest
    } catch {
      return null
    }
  }

  private scanPages(): IndexedDoc[] {
    const digestMap = new Map<string, DigestPage>()
    if (this.digest) {
      for (const page of this.digest.pages) {
        digestMap.set(page.path, page)
      }
    }

    const docs: IndexedDoc[] = []
    let docId = 0

    for (const dir of PAGE_DIRS) {
      const dirPath = join(this.vaultPath, dir)
      if (!existsSync(dirPath)) continue

      for (const entry of readdirSync(dirPath)) {
        if (!entry.endsWith('.md') || entry === 'index.md') continue

        try {
          const content = readFileSync(join(dirPath, entry), 'utf8')
          const relPath = `${dir}/${entry}`
          const digestPage = digestMap.get(relPath)
          const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m) ?? content.match(/^#\s+(.+)$/m)

          docs.push({
            content,
            freshnessLevel: digestPage?.freshnessLevel ?? 'unknown',
            id: docId++,
            kind: digestPage?.kind ?? dir.replace(/s$/, ''),
            pageId: digestPage?.id ?? `${dir}.${entry.replace(/\.md$/, '')}`,
            path: relPath,
            title: titleMatch?.[1] ?? entry.replace(/\.md$/, ''),
          })
        } catch {
          // Skip unreadable files
        }
      }
    }

    return docs
  }
}
