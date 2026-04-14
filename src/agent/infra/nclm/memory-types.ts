export interface MemoryEntry {
  access_count: number
  content: string
  content_hash: string
  created_at: number
  entry_type: 'raw' | 'summary'
  id: string
  importance: number
  status: 'active' | 'archived'
  stub: null | string
  tags: string[]
  title: string
  token_count: number
  update_count: number
  updated_at: number
  write_sequence: number
}

export interface MemoryStoreConfig {
  archive_importance_threshold?: number
  bm25?: {
    content_boost?: number
    fuzzy?: number
    prefix?: boolean
    tag_boost?: number
    title_boost?: number
  }
  condensation_trigger?: number
  injection?: {
    entries_budget?: number
    stubs_budget?: number
    summaries_budget?: number
  }
  min_entries_to_condense?: number
  recency_half_life_ms?: number
  scoring?: {
    min_relevance?: number
    score_gap_ratio?: number
    w_importance?: number
    w_recency?: number
    w_relevance?: number
  }
}

export interface WriteParams {
  content: string
  importance?: number
  tags?: string[]
  title: string
}

export interface UpdateParams {
  content?: string
  id: string
  importance?: number
  tags?: string[]
  title?: string
}

export interface SearchParams {
  /** Include archived entries in results. Default false. */
  include_archived?: boolean
  query: string
  /** Filter: entry must have at least one of these tags (OR semantics). */
  tags?: string[]
  /** Maximum results to return. Default 5. */
  top_k?: number
}

export interface ScoredEntry {
  bm25Score: number
  entry: MemoryEntry
  score: number
}

export interface ListParams {
  /** Return entries with write_sequence greater than this value. */
  after_sequence?: number
  /** Return entries with write_sequence less than this value. */
  before_sequence?: number
  entry_type?: 'raw' | 'summary'
  limit?: number
  sort_by?: 'importance' | 'updated_at' | 'write_sequence'
  sort_dir?: 'asc' | 'desc'
  status?: 'active' | 'all' | 'archived'
  tags?: string[]
}

export interface CompactResult {
  archivedIds: string[]
  summaryEntry: MemoryEntry
  tokensFreed: number
}

export interface LaneBudgets {
  entries: number
  stubs: number
  summaries: number
}

export interface SerializedMemoryStore {
  config: MemoryStoreConfig
  entries: MemoryEntry[]
  sequenceCounter: number
}

export interface MemoryStats {
  active_count: number
  archived_count: number
  summary_count: number
  tags: Record<string, number>
  total_count: number
  total_tokens: number
}
