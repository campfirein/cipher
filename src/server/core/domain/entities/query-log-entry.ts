// ── Single source of truth: runtime arrays → derived types ───────────────────
// Tiers originate from QueryExecutor (src/server/infra/executor/query-executor.ts).
// Statuses track the entry lifecycle. Both are domain concepts.

/** Valid resolution tiers. Add/remove here — the type updates automatically. */
export const QUERY_LOG_TIERS = [0, 1, 2, 3, 4] as const
export type QueryLogTier = (typeof QUERY_LOG_TIERS)[number]

export type TierKey = `tier${QueryLogTier}`

/** Human-readable labels for each resolution tier. */
export const QUERY_LOG_TIER_LABELS: Record<QueryLogTier, string> = {
  0: 'exact cache hit',
  1: 'fuzzy cache match',
  2: 'direct search',
  3: 'optimized LLM',
  4: 'full agentic',
}

/** Tiers considered cache hits for cache-hit-rate calculation. */
export const CACHE_TIERS = [0, 1] as const satisfies readonly QueryLogTier[]

export type ByTier = Record<TierKey, number> & {unknown: number}

// Single `as` contained here — TS cannot prove loop exhaustiveness over template literal keys.
export function emptyByTier(): ByTier {
  const obj: Record<string, number> = {}
  for (const t of QUERY_LOG_TIERS) {
    obj[`tier${t}`] = 0
  }

  obj.unknown = 0
  return obj as ByTier
}

/** Valid query log statuses. Add/remove here — the type updates automatically. */
export const QUERY_LOG_STATUSES = ['cancelled', 'completed', 'error', 'processing'] as const
export type QueryLogStatus = (typeof QUERY_LOG_STATUSES)[number]

// ── Entity types ─────────────────────────────────────────────────────────────

export type QueryLogMatchedDoc = {
  path: string
  score: number
  title: string
}

export type QueryLogSearchMetadata = {
  cacheFingerprint?: string
  resultCount: number
  topScore: number
  totalFound: number
}

type QueryLogBase = {
  id: string
  matchedDocs: QueryLogMatchedDoc[]
  query: string
  searchMetadata?: QueryLogSearchMetadata
  startedAt: number
  taskId: string
  tier?: QueryLogTier
  timing?: {durationMs: number}
}

export type QueryLogEntry =
  | (QueryLogBase & {completedAt: number; error: string; status: 'error'})
  | (QueryLogBase & {completedAt: number; response?: string; status: 'completed'})
  | (QueryLogBase & {completedAt: number; status: 'cancelled'})
  | (QueryLogBase & {status: 'processing'})
