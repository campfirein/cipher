/**
 * Loader for existing memory passed to the conflict-node.
 *
 * Phase 1: queries the context tree via SearchKnowledgeService for each
 * unique subject in the new facts. For each matched document, records the
 * subject as "already known" along with the matched file path (used as
 * `existingId` so conflict-node can emit `update` decisions).
 *
 * Phase 2 may parse facts out of matched markdown files for richer
 * conflict checks; Phase 1 only signals subject existence.
 */

import type {ISearchKnowledgeService} from '../../sandbox/tools-sdk.js'

export interface ExistingMemoryEntry {
  /** Path of the existing context-tree file holding this subject. */
  existingId?: string
  /**
   * A statement-shaped string. For Phase 1 this is just the file path
   * since we don't parse fact content out of markdown yet.
   */
  statement: string
  subject?: string
}

/**
 * Look up subjects in the context tree and return discovered entries.
 *
 * Returns an empty array if no search service is provided or all searches
 * fail (fail-open: a missing existing-memory check should not block curation).
 */
export async function loadExistingMemory(
  searchService: ISearchKnowledgeService | undefined,
  subjects: ReadonlyArray<string>,
  options: {limitPerSubject?: number} = {},
): Promise<ExistingMemoryEntry[]> {
  if (!searchService || subjects.length === 0) {
    return []
  }

  const limit = options.limitPerSubject ?? 3
  const seen = new Set<string>()
  const entries: ExistingMemoryEntry[] = []

  for (const subject of subjects) {
    if (seen.has(subject)) continue
    seen.add(subject)
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await searchService.search(subject, {limit})
      for (const match of result.results ?? []) {
        const existingId = match.path
        entries.push({
          existingId,
          statement: existingId ?? subject,
          subject,
        })
      }
    } catch {
      // Fail-open: skip this subject if search throws.
    }
  }

  return entries
}

/**
 * Collect unique subjects from a fact list (helper for callers).
 */
export function uniqueSubjects(
  facts: ReadonlyArray<{subject?: string}>,
): string[] {
  const subjects = new Set<string>()
  for (const fact of facts) {
    if (fact.subject) subjects.add(fact.subject)
  }

  return [...subjects]
}
