/**
 * Query decomposer template — transforms raw queries using YAML synonym
 * mappings and domain hints.
 *
 * Pure string operations, no I/O. Must complete in < 5ms.
 */

import {load as yamlLoad} from 'js-yaml'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DecomposedQuery {
  /** Preferred domains from query pattern matching */
  domainHints: string[]
  /** Additional terms from synonym expansion */
  expandedTerms: string[]
  /** The original unmodified query */
  originalQuery: string
}

interface DomainHintRule {
  preferDomains: string[]
  queryPattern: string
}

interface DecomposeTemplate {
  domainHints?: DomainHintRule[]
  synonyms?: Record<string, string[]>
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Decompose a raw query using synonym expansion and domain hint matching.
 *
 * @param rawQuery - The user's original search query
 * @param templateContent - YAML template with `synonyms` and `domainHints`
 * @returns Decomposed query with expanded terms and domain hints
 */
export function decomposeQuery(rawQuery: string, templateContent: string): DecomposedQuery {
  const result: DecomposedQuery = {
    domainHints: [],
    expandedTerms: [],
    originalQuery: rawQuery,
  }

  let template: DecomposeTemplate
  try {
    template = (yamlLoad(templateContent) as DecomposeTemplate) ?? {}
  } catch {
    return result
  }

  // Synonym expansion: for each query term, add synonyms if present
  const synonyms = template.synonyms ?? {}
  const queryLower = rawQuery.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(Boolean)

  for (const term of queryTerms) {
    const expansions = synonyms[term]
    if (Array.isArray(expansions)) {
      for (const syn of expansions) {
        if (typeof syn === 'string' && !result.expandedTerms.includes(syn)) {
          result.expandedTerms.push(syn)
        }
      }
    }
  }

  // Domain hint matching: supports wildcard patterns (e.g., "how does * work")
  // by converting * to .* regex, or falls back to substring match if no wildcards.
  const domainHintRules = template.domainHints ?? []
  for (const rule of domainHintRules) {
    if (
      typeof rule.queryPattern === 'string' &&
      matchesQueryPattern(queryLower, rule.queryPattern.toLowerCase()) &&
      Array.isArray(rule.preferDomains)
    ) {
      for (const domain of rule.preferDomains) {
        if (typeof domain === 'string' && !result.domainHints.includes(domain)) {
          result.domainHints.push(domain)
        }
      }
    }
  }

  return result
}

/** Regex cache to avoid recompilation on every call */
const patternCache = new Map<string, RegExp>()

/** Max cached patterns to prevent unbounded growth */
const MAX_PATTERN_CACHE = 100

/**
 * Match a query against a pattern that may contain * wildcards.
 * "how does * work" matches "how does auth work".
 * If no wildcards, falls back to substring match.
 *
 * Uses bounded repetition (.{0,200}) instead of .* to prevent ReDoS
 * from LLM-refined templates with pathological patterns like "a*a*a*b".
 * Compiled regexes are cached for performance at high query throughput.
 */
function matchesQueryPattern(query: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return query.includes(pattern)
  }

  let regex = patternCache.get(pattern)
  if (!regex) {
    // Escape regex special chars except *, then convert * to bounded match
    const escaped = pattern.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`).replaceAll('*', '.{0,200}')
    regex = new RegExp(`^${escaped}$`)

    // Evict oldest inserted entry (FIFO) if cache is full
    if (patternCache.size >= MAX_PATTERN_CACHE) {
      const firstKey = patternCache.keys().next().value
      if (firstKey !== undefined) patternCache.delete(firstKey)
    }

    patternCache.set(pattern, regex)
  }

  return regex.test(query)
}
