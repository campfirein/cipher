/**
 * Shared curation threshold — single source of truth.
 * Used by both pre-compaction (server layer) and curation helpers (agent layer).
 * Contexts below this threshold skip compaction and use single-pass curation.
 */
export const CURATION_CHAR_THRESHOLD = 20_000
