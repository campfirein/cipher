import type {QueryType} from '../../core/domain/swarm/types.js'

 

const TEMPORAL_SIGNALS = /\b(after|before|last week|recently|since|today|this month|when did|yesterday)\b/i
const PERSONAL_SIGNALS = /\b(how do I usually|I like|I prefer|I tend to|my opinion|my style)\b/i
const RELATIONAL_SIGNALS = /\b(connected|depends? on|links to|mentioned in|related to|see also)\b/i

 

/**
 * Classify a natural language query into a query type.
 * Uses lightweight regex rules — no LLM call needed.
 */
export function classifyQuery(query: string): QueryType {
  if (TEMPORAL_SIGNALS.test(query)) return 'temporal'
  if (PERSONAL_SIGNALS.test(query)) return 'personal'
  if (RELATIONAL_SIGNALS.test(query)) return 'relational'

  return 'factual'
}

/**
 * Provider selection matrix per query type.
 * ByteRover is always included. Other providers are conditionally active.
 */
/**
 * Provider selection matrix per query type.
 * Honcho and Hindsight are temporarily disabled — adapters coming in Phase 3.
 * When re-enabled, add 'honcho' to personal and 'hindsight' to temporal/relational.
 */
const SELECTION_MATRIX: Record<QueryType, string[]> = {
  factual: ['byterover', 'obsidian', 'local-markdown', 'gbrain', 'memory-wiki'],
  personal: ['byterover', 'obsidian', 'local-markdown'],
  relational: ['byterover', 'obsidian', 'local-markdown', 'gbrain', 'memory-wiki'],
  temporal: ['byterover', 'obsidian', 'local-markdown', 'gbrain', 'memory-wiki'],
}

/**
 * Select which providers to activate for a given query type.
 * Only returns providers that are in the available list.
 * Matches by prefix so `local-markdown:notes` matches the `local-markdown` selector.
 */
export function selectProviders(queryType: QueryType, availableProviderIds: string[]): string[] {
  const selectors = SELECTION_MATRIX[queryType]

  return availableProviderIds.filter((id) =>
    selectors.some((selector) => id === selector || id.startsWith(`${selector}:`))
  )
}
