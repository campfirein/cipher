/* eslint-disable camelcase */
import MiniSearch from 'minisearch'
import {createHash, randomUUID} from 'node:crypto'

import type {CompactResult, LaneBudgets, ListParams, MemoryEntry, MemoryStats, MemoryStoreConfig, ScoredEntry, SearchParams, SerializedMemoryStore, UpdateParams, WriteParams} from './memory-types.js'

const DEFAULT_SCORING = {
  min_relevance: 0.45,
  score_gap_ratio: 0.7,
  w_importance: 0.2,
  w_recency: 0.2,
  w_relevance: 0.6,
} as const

const DEFAULT_BM25 = {
  content_boost: 1,
  fuzzy: 0.2,
  prefix: true,
  tag_boost: 1.5,
  title_boost: 3,
} as const

const DEFAULT_INJECTION = {
  entries_budget: 4000,
  stubs_budget: 500,
  summaries_budget: 2000,
} as const

interface ResolvedScoringConfig {
  min_relevance: number
  score_gap_ratio: number
  w_importance: number
  w_recency: number
  w_relevance: number
}

interface ResolvedBm25Config {
  content_boost: number
  fuzzy: number
  prefix: boolean
  tag_boost: number
  title_boost: number
}

interface ResolvedInjectionConfig {
  entries_budget: number
  stubs_budget: number
  summaries_budget: number
}

interface ResolvedConfig {
  archive_importance_threshold: number
  bm25: ResolvedBm25Config
  condensation_trigger: number
  injection: ResolvedInjectionConfig
  min_entries_to_condense: number
  recency_half_life_ms: number
  scoring: ResolvedScoringConfig
}

function resolveConfig(userConfig?: MemoryStoreConfig): ResolvedConfig {
  return {
    archive_importance_threshold: userConfig?.archive_importance_threshold ?? 35,
    bm25: {...DEFAULT_BM25, ...userConfig?.bm25},
    condensation_trigger: userConfig?.condensation_trigger ?? 8,
    injection: {...DEFAULT_INJECTION, ...userConfig?.injection},
    min_entries_to_condense: userConfig?.min_entries_to_condense ?? 3,
    recency_half_life_ms: userConfig?.recency_half_life_ms ?? 1_800_000,
    scoring: {...DEFAULT_SCORING, ...userConfig?.scoring},
  }
}

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function computeTokenCount(content: string): number {
  return Math.ceil(content.length / 4)
}

function clampImportance(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function dedupeTags(tags: string[]): string[] {
  return [...new Set(tags)]
}

function normalizeBm25(rawScore: number): number {
  return rawScore / (1 + rawScore)
}

interface IndexedDoc {
  content: string
  id: string
  tagsText: string
  title: string
}

export class MemoryStore {
  private config: ResolvedConfig
  private readonly entries: Map<string, MemoryEntry> = new Map()
  private index: MiniSearch<IndexedDoc>
  private sequenceCounter = 0
  private userConfig: MemoryStoreConfig

  constructor(config?: MemoryStoreConfig) {
    this.userConfig = config ?? {}
    this.config = resolveConfig(config)
    this.index = this.createIndex()
  }

  archive(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.status === 'archived') {
      return
    }

    // Generate deterministic ghost cue: title + truncated content
    const maxStubLength = 200
    const truncated = entry.content.length > maxStubLength
      ? entry.content.slice(0, maxStubLength) + '...'
      : entry.content
    entry.stub = `${entry.title}: ${truncated}`

    entry.status = 'archived'

    // Re-index with stub content so archived entries remain searchable
    this.reindexEntry(entry)
  }

  buildInjection(budgets?: LaneBudgets): string {
    const b = budgets ?? {
      entries: this.config.injection.entries_budget,
      stubs: this.config.injection.stubs_budget,
      summaries: this.config.injection.summaries_budget,
    }

    let injection = ''

    // Lane 1: Summaries (broadest context first, highest importance)
    const summaries = [...this.entries.values()]
      .filter((e) => e.status === 'active' && e.entry_type === 'summary')
      .sort((a, b_) => b_.importance - a.importance)

    let lane1Used = 0
    if (summaries.length > 0) {
      injection += '### Memory Summaries\n'
      for (const s of summaries) {
        if (lane1Used + s.token_count > b.summaries) {
          break
        }

        injection += `- **${s.title}** [${s.tags.join(', ')}]: ${s.content}\n\n`
        lane1Used += s.token_count
      }
    }

    // Lane 2: Active raw entries (highest importance first)
    const rawEntries = [...this.entries.values()]
      .filter((e) => e.status === 'active' && e.entry_type === 'raw')
      .sort((a, b_) => b_.importance - a.importance)

    let lane2Used = 0
    if (rawEntries.length > 0) {
      injection += '### Active Memories\n'
      for (const e of rawEntries) {
        if (lane2Used + e.token_count > b.entries) {
          break
        }

        const preview = e.content.length > 500 ? e.content.slice(0, 500) + '...' : e.content
        injection += `- **${e.title}** [${e.tags.join(', ')}] (importance:${e.importance}): ${preview}\n\n`
        lane2Used += e.token_count
      }
    }

    // Lane 3: Archive stubs (ghost cues)
    const stubs = [...this.entries.values()]
      .filter((e) => e.status === 'archived' && e.stub)

    let lane3Used = 0
    if (stubs.length > 0) {
      injection += '### Archived (available via memory_read)\n'
      for (const s of stubs) {
        const stubTokens = computeTokenCount(s.stub ?? '')
        if (lane3Used + stubTokens > b.stubs) {
          break
        }

        injection += `- ${s.title} [${s.tags.join(', ')}]: ${s.stub}\n`
        lane3Used += stubTokens
      }
    }

    // Stats footer
    const st = this.stats()
    injection += `\n_${st.active_count} active, ${st.archived_count} archived, ${st.total_tokens} tokens_\n`
    injection += '_Use tools.memory.search/write/read/list in code_exec to interact with working memory._\n'

    return injection
  }

  compact(tag?: string): CompactResult {
    // Gather candidate entries: active, raw, matching tag
    const candidates = [...this.entries.values()]
      .filter((e) =>
        e.status === 'active' &&
        e.entry_type === 'raw' &&
        (!tag || e.tags.includes(tag)),
      )
      .sort((a, b) => a.importance - b.importance)

    if (candidates.length < this.config.min_entries_to_condense) {
      throw new Error(
        `Not enough entries to condense (have ${candidates.length}, need ${this.config.min_entries_to_condense})`,
      )
    }

    // Take the lower half (lowest importance) for condensation
    const toCondense = candidates.slice(0, Math.max(this.config.min_entries_to_condense, Math.floor(candidates.length / 2)))

    // Deterministic summary: concatenate titles and truncated content
    const summaryParts = toCondense.map((e) => {
      const contentTrunc = e.content.length > 150 ? e.content.slice(0, 150) + '...' : e.content

      return `- ${e.title}: ${contentTrunc}`
    })
    const summaryContent = summaryParts.join('\n')

    // Collect tags from all condensed entries
    const allTags = [...new Set(toCondense.flatMap((e) => e.tags))]
    const maxImportance = Math.max(...toCondense.map((e) => e.importance))

    // Create summary entry
    const summaryEntry = this.write({
      content: summaryContent,
      importance: maxImportance,
      tags: tag ? [tag] : allTags,
      title: `Summary: ${tag ?? 'mixed'} (${toCondense.length} entries)`,
    })
    summaryEntry.entry_type = 'summary'

    // Compute tokens before archiving
    const tokensBefore = toCondense.reduce((sum, e) => sum + e.token_count, 0)

    // Archive originals
    const archivedIds: string[] = []
    for (const e of toCondense) {
      this.archive(e.id)
      archivedIds.push(e.id)
    }

    return {
      archivedIds,
      summaryEntry,
      tokensFreed: tokensBefore - summaryEntry.token_count,
    }
  }

  deserialize(data: SerializedMemoryStore): void {
    // Restore config so scoring/BM25/injection settings match the serialized store.
    // Defensive ?? {} handles legacy payloads missing the config key.
    this.userConfig = data.config ?? {}
    this.config = resolveConfig(this.userConfig)

    // Clear existing state and rebuild index with restored config
    this.entries.clear()
    this.index = this.createIndex()
    this.sequenceCounter = data.sequenceCounter

    // Restore entries and index them
    for (const entry of data.entries) {
      this.entries.set(entry.id, entry)
      this.indexEntry(entry)
    }
  }

  free(id: string): void {
    if (this.index.has(id)) {
      this.index.discard(id)
    }

    this.entries.delete(id)
  }

  latest(tag?: string): MemoryEntry | null {
    let best: MemoryEntry | null = null

    for (const entry of this.entries.values()) {
      if (entry.status !== 'active') {
        continue
      }

      if (tag && !entry.tags.includes(tag)) {
        continue
      }

      if (!best || entry.write_sequence > best.write_sequence) {
        best = entry
      }
    }

    return best
  }

  list(params?: ListParams): MemoryEntry[] {
    const {
      after_sequence: afterSeq,
      before_sequence: beforeSeq,
      entry_type: entryType,
      limit = 20,
      sort_by: sortBy = 'write_sequence',
      sort_dir: sortDir = 'desc',
      status = 'active',
      tags,
    } = params ?? {}

    let results = [...this.entries.values()]

    // Status filter
    if (status !== 'all') {
      results = results.filter((e) => e.status === status)
    }

    // Tag filter (OR semantics)
    if (tags) {
      results = results.filter((e) => tags.some((t) => e.tags.includes(t)))
    }

    // Entry type filter
    if (entryType) {
      results = results.filter((e) => e.entry_type === entryType)
    }

    // Temporal range filters
    if (afterSeq !== undefined) {
      results = results.filter((e) => e.write_sequence > afterSeq)
    }

    if (beforeSeq !== undefined) {
      results = results.filter((e) => e.write_sequence < beforeSeq)
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1
    results.sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]

      return (aVal - bVal) * dir
    })

    return results.slice(0, limit)
  }

  read(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null
  }

  search(params: SearchParams): ScoredEntry[] {
    const {include_archived: includeArchived = false, query, tags, top_k: topK = 5} = params

    // Empty or whitespace-only query cannot produce meaningful BM25 results
    if (!query || query.trim() === '') {
      return []
    }

    const bm25Results = this.index.search(query)
    if (bm25Results.length === 0) {
      return []
    }

    const now = Date.now()
    const scored: ScoredEntry[] = []

    for (const result of bm25Results) {
      const entry = this.entries.get(result.id)
      if (!entry) {
        continue
      }

      if (!includeArchived && entry.status === 'archived') {
        continue
      }

      // Tag filter: OR semantics — entry must have at least one of the listed tags
      if (tags && !tags.some((t) => entry.tags.includes(t))) {
        continue
      }

      const bm25Score = normalizeBm25(result.score)

      const elapsed = now - entry.updated_at
      const recency = Math.exp(-elapsed / this.config.recency_half_life_ms)

      // Importance decays over time so stale high-importance entries don't dominate.
      // This is an intentional extension of the base formula (0.2 * importance/100);
      // the 0.995^days decay matches the context tree's importance_daily_decay rate.
      const daysSince = elapsed / 86_400_000
      const decayedImportance = entry.importance * (0.995 ** daysSince)

      const score =
        this.config.scoring.w_relevance * bm25Score +
        this.config.scoring.w_importance * (decayedImportance / 100) +
        this.config.scoring.w_recency * recency

      scored.push({bm25Score, entry, score})
    }

    scored.sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      return []
    }

    // OOD floor: if the best result's compound score is below min_relevance,
    // the query is considered out-of-domain — return nothing.
    if (scored[0].score < this.config.scoring.min_relevance) {
      return []
    }

    // Score-gap filtering: drop results below 0.7 * top score
    const topScore = scored[0].score
    const gapFiltered = scored.filter((s) => s.score >= topScore * this.config.scoring.score_gap_ratio)

    const results = gapFiltered.slice(0, topK)

    // Access feedback: +3 importance per search hit (context tree FinMem pattern)
    for (const r of results) {
      r.entry.access_count++
      r.entry.importance = clampImportance(r.entry.importance + 3)
    }

    return results
  }

  serialize(): SerializedMemoryStore {
    return {
      config: this.userConfig,
      entries: [...this.entries.values()],
      sequenceCounter: this.sequenceCounter,
    }
  }

  stats(): MemoryStats {
    let activeCount = 0
    let archivedCount = 0
    let summaryCount = 0
    let totalTokens = 0
    const tags: Record<string, number> = {}

    for (const entry of this.entries.values()) {
      if (entry.status === 'active') {
        activeCount++
        totalTokens += entry.token_count

        if (entry.entry_type === 'summary') {
          summaryCount++
        }

        for (const tag of entry.tags) {
          tags[tag] = (tags[tag] ?? 0) + 1
        }
      } else {
        archivedCount++
      }
    }

    return {
      active_count: activeCount,
      archived_count: archivedCount,
      summary_count: summaryCount,
      tags,
      total_count: activeCount + archivedCount,
      total_tokens: totalTokens,
    }
  }

  update(params: UpdateParams): MemoryEntry {
    const entry = this.entries.get(params.id)
    if (!entry) {
      throw new Error(`Entry ${params.id} not found`)
    }

    if (params.title !== undefined) {
      if (params.title.trim() === '') {
        throw new Error('title must be non-empty')
      }

      entry.title = params.title
    }

    if (params.content !== undefined) {
      entry.content = params.content
      entry.content_hash = computeContentHash(params.content)
      entry.token_count = computeTokenCount(params.content)
    }

    if (params.tags !== undefined) {
      entry.tags = dedupeTags(params.tags)
    }

    entry.importance = params.importance === undefined
      ? clampImportance(entry.importance + 5)
      : clampImportance(params.importance)

    entry.update_count++
    entry.write_sequence = ++this.sequenceCounter
    entry.updated_at = Date.now()

    this.reindexEntry(entry)

    return entry
  }

  write(params: WriteParams): MemoryEntry {
    if (!params.title || params.title.trim() === '') {
      throw new Error('title is required and must be non-empty')
    }

    const now = Date.now()
    const entry: MemoryEntry = {
      access_count: 0,
      content: params.content,
      content_hash: computeContentHash(params.content),
      created_at: now,
      entry_type: 'raw',
      id: randomUUID(),
      importance: clampImportance(params.importance ?? 50),
      status: 'active',
      stub: null,
      tags: dedupeTags(params.tags ?? []),
      title: params.title,
      token_count: computeTokenCount(params.content),
      update_count: 0,
      updated_at: now,
      write_sequence: ++this.sequenceCounter,
    }

    this.entries.set(entry.id, entry)
    this.indexEntry(entry)

    return entry
  }

  private createIndex(): MiniSearch<IndexedDoc> {
    return new MiniSearch<IndexedDoc>({
      fields: ['title', 'content', 'tagsText'],
      idField: 'id',
      searchOptions: {
        boost: {
          content: this.config.bm25.content_boost,
          tagsText: this.config.bm25.tag_boost,
          title: this.config.bm25.title_boost,
        },
        fuzzy: this.config.bm25.fuzzy,
        prefix: this.config.bm25.prefix,
      },
      storeFields: ['title'],
    })
  }

  private indexEntry(entry: MemoryEntry): void {
    // Archived entries are indexed with stub content (ghost cue) so searches
    // match the summary, not the full original content.
    const indexContent = entry.status === 'archived' && entry.stub
      ? entry.stub
      : entry.content

    this.index.add({
      content: indexContent,
      id: entry.id,
      tagsText: entry.tags.join(' '),
      title: entry.title,
    })
  }

  private rebuildIndex(): void {
    // MiniSearch discard() is lazy — old tokens remain in the inverted index
    // until vacuum() (async). To guarantee correct search results after
    // re-indexing, we rebuild the full index synchronously.
    // This is O(N) but N is small (working memory, not millions of docs).
    this.index.removeAll()
    for (const entry of this.entries.values()) {
      this.indexEntry(entry)
    }
  }

  private reindexEntry(_entry: MemoryEntry): void {
    this.rebuildIndex()
  }
}
