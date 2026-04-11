/**
 * Type definitions for the Hierarchical DAG architecture.
 *
 * Covers summary nodes, archive stubs, manifest entries, and
 * result types used by summary/archive/manifest services.
 */

// ---------------------------------------------------------------------------
// Condensation order & summary level
// ---------------------------------------------------------------------------

/** Condensation order: 0 = raw context, 1 = topic, 2 = domain, 3 = root */
export type CondensationOrder = 0 | 1 | 2 | 3

/** Summary level labels corresponding to condensation orders */
export type SummaryLevel = 'd0' | 'd1' | 'd2' | 'd3'

// ---------------------------------------------------------------------------
// Summary frontmatter
// ---------------------------------------------------------------------------

export interface SummaryFrontmatter {
  /** Hash of sorted path:contentHash pairs for staleness detection */
  children_hash: string
  /** Compression ratio achieved (output tokens / input tokens) */
  compression_ratio: number
  /** Condensation order (depth from leaves) */
  condensation_order: CondensationOrder
  /** Sorted child names this summary covers */
  covers: string[]
  /** Total tokens across all covered children */
  covers_token_total: number
  /** Summary level label */
  summary_level: SummaryLevel
  /** Token count of this summary */
  token_count: number
  /** Discriminator */
  type: 'summary'
}

// ---------------------------------------------------------------------------
// Archive stub frontmatter
// ---------------------------------------------------------------------------

export interface ArchiveStubFrontmatter {
  /** ISO timestamp when the entry was evicted */
  evicted_at: string
  /** Importance score at eviction time */
  evicted_importance: number
  /** Original relative path before archiving (for restore) */
  original_path: string
  /** Original token count before archiving */
  original_token_count: number
  /** Relative path to the .full.md preserved content */
  points_to: string
  /** Discriminator */
  type: 'archive_stub'
}

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  /** Relative path to .abstract.md sibling, if it exists */
  abstractPath?: string
  /** Token count of .abstract.md (used for lane budgeting) */
  abstractTokens?: number
  /** Importance score from frontmatter (0-100, default 50) */
  importance?: number
  /** Condensation order (only for summaries) */
  order?: CondensationOrder
  /** Relative path within the context tree */
  path: string
  /** Estimated token count */
  tokens: number
  /** Entry type */
  type: 'context' | 'stub' | 'summary'
}

export interface LaneTokens {
  contexts: number
  stubs: number
  summaries: number
}

export interface ContextManifest {
  /** Active context entries selected by lane budgeting */
  active_context: ManifestEntry[]
  /** ISO timestamp when the manifest was generated */
  generated_at: string
  /** Token allocation per lane */
  lane_tokens: LaneTokens
  /** Fingerprint of source files (hash of sorted path:mtime:size) for freshness check */
  source_fingerprint: string
  /** Total tokens across all active entries */
  total_tokens: number
  /** Schema version */
  version: 1
}

export const DEFAULT_LANE_BUDGETS: LaneTokens = {contexts: 4000, stubs: 500, summaries: 2000}

// ---------------------------------------------------------------------------
// Service result types
// ---------------------------------------------------------------------------

export interface StalenessCheckResult {
  /** Recomputed hash from current children */
  currentChildrenHash: string
  /** Whether the summary is stale */
  isStale: boolean
  /** Directory path checked */
  path: string
  /** Hash stored in existing _index.md (empty string if no summary exists) */
  storedChildrenHash: string
}

export interface SummaryGenerationResult {
  /** Whether a summary was actually written */
  actionTaken: boolean
  /** Compression ratio achieved (0 if not generated) */
  compressionRatio: number
  /** Directory path */
  path: string
  /** Why generation was skipped (only set when actionTaken is false) */
  reason?: 'empty_directory' | 'io_error' | 'llm_error'
  /** Which escalation tier succeeded */
  tier?: 'aggressive' | 'fallback' | 'normal'
  /** Token count of the generated summary (0 if not generated) */
  tokenCount: number
}

export interface ArchiveResult {
  /** Path to the .full.md preserved content */
  fullPath: string
  /** Token count of the ghost cue */
  ghostCueTokenCount: number
  /** Original relative path of the archived entry */
  originalPath: string
  /** Path to the .stub.md ghost cue */
  stubPath: string
}

export interface DrillDownResult {
  /** Full original content */
  fullContent: string
  /** Original path before archiving */
  originalPath: string
  /** Token count of the full content */
  tokenCount: number
}

export interface ResolvedEntry {
  /** File content */
  content: string
  /** Relative path */
  path: string
  /** Token count */
  tokens: number
  /** Entry type */
  type: 'context' | 'stub' | 'summary'
}
