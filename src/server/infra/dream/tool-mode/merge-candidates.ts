/**
 * Merge candidate generator for tool-mode dream.
 *
 * Same BM25 path as `link-candidates` but with a higher default threshold
 * (0.85 vs 0.5) and no awareness of existing `related` edges — merge is
 * for *near-duplicates*, link is for *complementary topics*. An already-
 * linked pair can still be a merge candidate if the similarity is high.
 *
 * The calling agent decides per pair which topic becomes the survivor and
 * authors the merged HTML via `brv curate` UPDATE; the loser is archived
 * later via `brv dream finalize --archive`.
 */

import type {ISearchKnowledgeService} from '../../../../agent/infra/sandbox/tools-sdk.js'

export type MergeCandidateTopic = {
  /** Full raw HTML — supplied to the agent so it can author the merge body without a second fetch. */
  html: string
  /** Relative path under .brv/context-tree/. */
  path: string
  /** Topic summary attr value, or empty string. */
  summary: string
  /** Topic title attr value. */
  title: string
}

export type MergeCandidate = {
  htmlA: string
  htmlB: string
  /** [pathA, pathB], lex-sorted. */
  pair: [string, string]
  score: number
}

export type FindMergeCandidatesOptions = {
  maxCandidates?: number
  scope?: string
  /** Default 0.85. Higher than link's 0.5 — merge needs near-duplicate similarity. */
  scoreThreshold?: number
}

const DEFAULT_MAX_CANDIDATES = 20
const DEFAULT_SCORE_THRESHOLD = 0.85
const SEARCH_LIMIT_PER_TOPIC = 10

export async function findMergeCandidates(params: {
  options?: FindMergeCandidatesOptions
  searchService: ISearchKnowledgeService
  topics: MergeCandidateTopic[]
}): Promise<MergeCandidate[]> {
  const {options, searchService, topics} = params
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const scoreThreshold = options?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const scope = options?.scope

  const inScope = scope ? topics.filter((t) => t.path.startsWith(scope)) : topics
  if (inScope.length < 2) return []

  const byPath = new Map<string, MergeCandidateTopic>(inScope.map((t) => [t.path, t]))

  const perTopicHits = await Promise.all(
    inScope.map(async (source) => {
      const query = `${source.title} ${source.summary}`.trim()
      if (!query) return {hits: [], source}
      const result = await searchService.search(query, {limit: SEARCH_LIMIT_PER_TOPIC})
      return {hits: result.results, source}
    }),
  )

  const pairs = new Map<string, {pair: [string, string]; score: number}>()
  for (const {hits, source} of perTopicHits) {
    for (const hit of hits) {
      if (hit.score < scoreThreshold) continue
      if (hit.path === source.path) continue
      if (!byPath.has(hit.path)) continue

      const [a, b] = source.path < hit.path ? [source.path, hit.path] : [hit.path, source.path]
      const key = `${a}|${b}`
      const existing = pairs.get(key)
      if (!existing || hit.score > existing.score) {
        pairs.set(key, {pair: [a, b], score: hit.score})
      }
    }
  }

  return [...pairs.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, maxCandidates)
    .map(({pair, score}): MergeCandidate => {
      const topicA = byPath.get(pair[0])
      const topicB = byPath.get(pair[1])
      if (!topicA || !topicB) throw new Error(`merge-candidates: pair lookup failed for ${pair[0]} or ${pair[1]}`)
      return {htmlA: topicA.html, htmlB: topicB.html, pair, score}
    })
}
