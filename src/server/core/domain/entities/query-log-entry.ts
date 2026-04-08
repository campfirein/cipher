// Stub: domain types driven by brv query-log view command (ENG-1897).
// Full QueryLogEntry discriminated union will be added in ENG-1887.

// ── Single source of truth: runtime arrays → derived types ───────────────────
// Tiers originate from QueryExecutor (src/server/infra/executor/query-executor.ts).
// Statuses track the entry lifecycle. Both are domain concepts.

/** Valid resolution tiers. Add/remove here — the type updates automatically. */
export const QUERY_LOG_TIERS = [0, 1, 2, 3, 4] as const
export type QueryLogTier = (typeof QUERY_LOG_TIERS)[number]

/** Valid query log statuses. Add/remove here — the type updates automatically. */
export const QUERY_LOG_STATUSES = ['cancelled', 'completed', 'error', 'processing'] as const
export type QueryLogStatus = (typeof QUERY_LOG_STATUSES)[number]
