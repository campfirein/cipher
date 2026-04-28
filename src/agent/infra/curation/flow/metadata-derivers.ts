/**
 * Phase 2.5 R-2 — deterministic metadata derivers (PHASE-2.5-PLAN.md §3.3).
 *
 * Derives `tags`, `keywords`, and `related` for curate operations from
 * the fact + batch context already in hand — no extra LLM call.
 *
 * Phase 3 UAT flagged that 86/86 leaf files had empty `tags`/`keywords`/
 * `related`, blocking the `brv query` cross-link layer. This module
 * unblocks that with cheap heuristics; Phase 4's enrichment slot can
 * overlay LLM-derived metadata later without breaking Phase 2.5 data.
 *
 * Lives in its own module (not scope-private inside `services-adapter.ts`)
 * so it can be unit-tested directly without test-only exports — the
 * helpers are pure functions over plain inputs with no infra deps.
 */

import {toSnakeCase} from '../../../../server/utils/file-helpers.js'

export interface DerivableFact {
  category?: string
  statement: string
  subject?: string
}

export interface DerivableDecision {
  readonly action: string
  readonly fact: DerivableFact
}

/**
 * Tokens excluded from `keywords`. Curated short-list — adding more
 * stopwords is fine; bloat (1000+ entries with duplicates) is not.
 */
const STOP_WORDS = new Set([
  'a', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'before', 'being', 'but', 'by', 'did', 'do', 'does', 'each',
  'for', 'from', 'has', 'have', 'he', 'how', 'in', 'is',
  'it', 'its', 'just', 'no', 'not', 'of', 'on', 'only',
  'or', 'so', 'such', 'than', 'that', 'the', 'their', 'then', 'these',
  'this', 'those', 'to', 'too', 'was', 'were', 'what', 'when',
  'where', 'which', 'who', 'whom', 'whose', 'why', 'will', 'with',
])

/**
 * Tag set for a fact: lowercase {category, subject} dedup'd.
 * Used by the BM25 ranker as a high-signal facet during retrieval.
 */
export function deriveTags(fact: DerivableFact): string[] {
  const tags: string[] = []
  if (fact.category) tags.push(fact.category.toLowerCase())
  if (fact.subject) tags.push(fact.subject.toLowerCase())
  return [...new Set(tags)]
}

/**
 * Keyword bag: subject (first) + meaningful tokens from the statement,
 * stop-word-filtered and capped at 8.
 */
export function deriveKeywords(fact: DerivableFact): string[] {
  const out: string[] = []
  if (fact.subject) out.push(fact.subject.toLowerCase())
  const words = fact.statement
    .toLowerCase()
    .replaceAll(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  for (const w of words) {
    if (!out.includes(w)) out.push(w)
  }

  return out.slice(0, 8)
}

/**
 * Related sibling paths in the same batch: cross-link decisions sharing
 * the same `category` but with distinct subjects. Emits a 3-segment path
 * `<category>/<subject>/<subject>` matching R-4's file layout
 * (`<domain>/<subject>/<subject>.md`).
 *
 * Slug parity: every segment runs through `toSnakeCase` — the same helper
 * `executeAdd`/`executeUpdate` use to slug filenames. Without this,
 * subjects with hyphens or punctuation (`rate-limit`, `same=site`) would
 * produce relation paths that don't match the actual on-disk file.
 *
 * Cross-tree relations (BM25 against existing files) are deferred to
 * Phase 4 dream consolidation — would need a SearchService dependency.
 */
export function deriveRelated(
  current: DerivableDecision,
  allDecisions: ReadonlyArray<DerivableDecision>,
): string[] {
  const related = new Set<string>()
  for (const other of allDecisions) {
    if (other === current) continue
    if (
      other.fact.category &&
      other.fact.category === current.fact.category &&
      other.fact.subject &&
      other.fact.subject !== current.fact.subject
    ) {
      const cat = toSnakeCase(other.fact.category)
      const sub = toSnakeCase(other.fact.subject)
      related.add(`${cat}/${sub}/${sub}`)
    }
  }

  return [...related]
}

/**
 * Resolved decision: a `DerivableDecision` paired with the on-disk
 * `(path, title)` it routes to. The two-pass services-adapter.write
 * computes this map BEFORE building operations, so `deriveRelatedFromResolved`
 * has the information it needs to filter out cross-links that would point
 * to non-existent files.
 */
export interface ResolvedDecision {
  readonly decision: DerivableDecision
  readonly path: string
  readonly title: string
}

/**
 * NEW-1 (PHASE-2.6-PLAN.md §3.2) — like `deriveRelated` but operates over
 * RESOLVED target paths, so:
 *   - Same-category decisions whose target file is the current decision's
 *     own file (R-4 UPSERT collision OR cross-batch UPDATE merge) are
 *     filtered out — they're not "siblings", they ARE the same file.
 *   - The emitted path matches what executeCurate will actually write
 *     (uses `toSnakeCase` per segment per slug-parity contract from
 *     Phase 2.5 §3.3 P1).
 *
 * Cross-tree relations (BM25 against existing files outside this batch)
 * are still deferred to Phase 4 dream consolidation.
 *
 * Phase 4 UAT exposed the bug: when 3 decisions for distinct subjects
 * (jwt_token_ttl, jwt_storage, samesite) all UPDATE-merged into one
 * existing file, the original `deriveRelated` emitted phantom paths to
 * `<category>/<subject>/<subject>.md` that were never materialized.
 */
export function deriveRelatedFromResolved(
  current: ResolvedDecision,
  allResolved: ReadonlyArray<ResolvedDecision>,
): string[] {
  const currentTargetKey = `${slugifyPath(current.path)}/${toSnakeCase(current.title)}`
  const related = new Set<string>()
  for (const other of allResolved) {
    if (other === current) continue

    const otherTargetKey = `${slugifyPath(other.path)}/${toSnakeCase(other.title)}`
    if (otherTargetKey === currentTargetKey) continue // same file — not related, IS me

    // Same-category cross-link logic (preserved from deriveRelated).
    if (
      other.decision.fact.category &&
      other.decision.fact.category === current.decision.fact.category &&
      other.decision.fact.subject &&
      other.decision.fact.subject !== current.decision.fact.subject
    ) {
      related.add(otherTargetKey)
    }
  }

  return [...related]
}

/**
 * Slug each `/`-segment with `toSnakeCase` so a path like
 * `project/rate-limit` matches the on-disk `project/rate_limit/`.
 * `toSnakeCase` itself collapses `[^\w]+` → `_`, which would mangle
 * the `/` separators if applied to the whole path.
 */
function slugifyPath(path: string): string {
  return path.split('/').map((seg) => toSnakeCase(seg)).join('/')
}
