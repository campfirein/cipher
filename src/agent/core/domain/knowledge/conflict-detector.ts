import type {ContextData, Narrative, RawConcept} from '../../../../server/core/domain/knowledge/markdown-writer.js'

/**
 * Summary of detected structural loss when comparing existing vs proposed content.
 */
export type StructuralLoss = {
  hasLoss: boolean
  /** Number of rawConcept array items (changes, files) that would be lost */
  lostArrayItems: number
  /** Number of narrative fields that would be lost */
  lostNarrativeFields: number
  /** Number of rawConcept scalar fields that would be lost */
  lostRawConceptFields: number
  /** Number of relations that would be lost */
  lostRelations: number
  /** Number of snippets that would be lost */
  lostSnippets: number
}

/**
 * Normalize a string for comparison (trim and lowercase).
 */
function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Find items in `existing` that are not in `proposed` (case-insensitive).
 */
function countLostItems(existing: string[], proposed: string[]): number {
  const proposedSet = new Set(proposed.map((s) => normalize(s)))
  return existing.filter((item) => !proposedSet.has(normalize(item))).length
}

/**
 * Count narrative fields that exist in `existing` but are absent in `proposed`.
 */
function countLostNarrativeFields(existing?: Narrative, proposed?: Narrative): number {
  if (!existing) return 0

  const fields: Array<keyof Narrative> = ['dependencies', 'examples', 'highlights', 'rules', 'structure']
  return fields.filter((field) => existing[field] && !proposed?.[field]).length
}

/**
 * Count rawConcept scalar fields and array items that would be lost.
 */
function countLostRawConceptFields(
  existing?: RawConcept,
  proposed?: RawConcept,
): {arrayItems: number; scalars: number} {
  if (!existing) return {arrayItems: 0, scalars: 0}

  const scalarFields: Array<keyof RawConcept> = ['author', 'flow', 'task', 'timestamp']
  const scalars = scalarFields.filter((field) => existing[field] && !proposed?.[field]).length

  const existingChanges = existing.changes ?? []
  const existingFiles = existing.files ?? []
  const proposedChanges = proposed?.changes ?? []
  const proposedFiles = proposed?.files ?? []

  const arrayItems =
    countLostItems(existingChanges, proposedChanges) + countLostItems(existingFiles, proposedFiles)

  return {arrayItems, scalars}
}

/**
 * Detect structural loss between existing content and proposed content.
 *
 * Only flags when existing content would be LOST, not when new content is added.
 * This prevents false positives when the LLM is enriching content.
 *
 * @param existing - Parsed content from the existing file
 * @param proposed - Proposed new content from the curate operation
 * @returns StructuralLoss summary
 */
export function detectStructuralLoss(existing: ContextData, proposed: ContextData): StructuralLoss {
  const lostSnippets = countLostItems(existing.snippets ?? [], proposed.snippets ?? [])
  const lostRelations = countLostItems(existing.relations ?? [], proposed.relations ?? [])
  const lostNarrativeFields = countLostNarrativeFields(existing.narrative, proposed.narrative)
  const {arrayItems: lostArrayItems, scalars: lostRawConceptFields} = countLostRawConceptFields(
    existing.rawConcept,
    proposed.rawConcept,
  )

  const hasLoss =
    lostSnippets > 0 || lostRelations > 0 || lostNarrativeFields > 0 || lostRawConceptFields > 0 || lostArrayItems > 0

  return {
    hasLoss,
    lostArrayItems,
    lostNarrativeFields,
    lostRawConceptFields,
    lostRelations,
    lostSnippets,
  }
}

/**
 * Derive the structural impact level from detected loss.
 *
 * - Any structural loss → 'high'
 * - No loss → 'low'
 *
 * @param loss - Structural loss summary from detectStructuralLoss
 * @returns Impact level derived from structural evidence
 */
export function deriveImpactFromLoss(loss: StructuralLoss): 'high' | 'low' {
  if (!loss.hasLoss) return 'low'
  return 'high'
}
