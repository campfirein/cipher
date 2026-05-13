/**
 * Tool-mode query retrieval orchestrator — placeholder shape for T1.
 *
 * Background. `brv query` legacy path runs Tier-0/1/2/3/4 inside the
 * daemon, with Tier 3 and Tier 4 invoking byterover's own LLM. Tool
 * mode removes those tiers: the calling agent owns synthesis, byterover
 * just retrieves matches and returns them. No LLM lives inside
 * byterover on this path.
 *
 * One-shot (unlike curate's session loop). Query has no validation
 * step that can fail and no atomic-write atomicity to preserve across
 * calls — every invocation is a fresh BM25 search. No session, no
 * continuation, no state on disk.
 *
 * This file currently ships the wire-envelope types and a placeholder
 * `runRetrievalPlaceholder` that always returns zero matches. T2
 * (ENG-2812) replaces the placeholder with a real `runRetrieval` that
 * calls SearchKnowledgeService.
 *
 * Stability promise. Wire envelope keys are part of the public
 * contract once SKILL.md (T4 / ENG-2814) ships against this shape.
 * Renaming any key here is a breaking change.
 */

/**
 * One match returned by retrieval. Both `renderedContent` and
 * `rawContent` are included so the calling agent can pick: rendered
 * markdown (default consumption) or source bytes (for callers that
 * want their own HTML parsing).
 */
export type QueryMatch = {
  /** `'html'` or `'markdown'` derived from the file extension. */
  format: 'html' | 'markdown'
  /** Path relative to `<projectRoot>/.brv/context-tree/`. */
  path: string
  /**
   * Source bytes regardless of format. For `.html` topics this is the
   * raw `<bv-topic>...</bv-topic>` markup. For `.md` topics this is
   * the same as `renderedContent`.
   */
  rawContent: string
  /**
   * For `.html` topics, post-`renderHtmlTopicForLlm` markdown (clean
   * bv-* attribute preservation as inline markdown, raw markup
   * stripped). For `.md` topics, raw bytes pass through unchanged.
   */
  renderedContent: string
  /**
   * BM25 score from the search service. Comparable within a single
   * retrieval (i.e. relative ranking inside `matches[]`) but NOT
   * comparable across different context-trees or BM25 index versions.
   */
  score: number
}

/** Error kinds the envelope can surface. Stable contract for T4 SKILL.md. */
export type QueryEnvelopeErrorKind =
  | 'index-unavailable'
  | 'invalid-flag-combination'
  | 'missing-query'

/** Flat error shape carried in the envelope's `errors` array. */
export type QueryEnvelopeError = {
  kind: QueryEnvelopeErrorKind
  message: string
}

/**
 * Wire envelope returned by every tool-mode query call. One-shot:
 * `done`/`continuation`-style states don't exist for query.
 *
 * - `status: 'results'` — retrieval completed. `matches` is always
 *   present (possibly empty). `synthesisPrompt` is present iff
 *   `matches.length > 0` (T3 fills in the prompt body; T1 leaves it
 *   undefined).
 * - `status: 'failed'` — retrieval could not run. `errors[]` explains
 *   why.
 */
export type QueryToolModeEnvelope = {
  /** Validation / dispatch errors. Present on `failed`. */
  errors?: QueryEnvelopeError[]
  /** Retrieved topics, ordered by relevance descending. */
  matches?: QueryMatch[]
  /** Aggregated success flag — `true` on `results`, `false` on `failed`. */
  ok: boolean
  status: 'failed' | 'results'
  /**
   * Free-text synthesis instruction for the calling agent's LLM. Built
   * by `buildSynthesisPrompt` (T3 / ENG-2813). Present iff
   * `matches.length > 0`. T1 leaves this undefined.
   */
  synthesisPrompt?: string
}

/**
 * Placeholder retrieval used by T1. Always returns zero matches so
 * the protocol surface (envelope shape, dispatch, flag validation,
 * documentation) can be reviewed in isolation before T2 wires the
 * real SearchKnowledgeService call.
 *
 * Signature is deliberately what `runRetrieval` will look like in T2,
 * so swap-out is a single-file change.
 */
export function runRetrievalPlaceholder(_options: {
  limit: number
  projectRoot: string
  query: string
}): Promise<QueryToolModeEnvelope> {
  return Promise.resolve({
    matches: [],
    ok: true,
    status: 'results',
  })
}
