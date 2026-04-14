import type {ContextData, Narrative, RawConcept} from '../../../../server/core/domain/knowledge/markdown-writer.js'
import type {StructuralLoss} from './conflict-detector.js'

import {normalize} from './utils.js'

/**
 * Merge two arrays with case-insensitive deduplication.
 * Existing items come first (preserves original order), then new items from proposed.
 */
function mergeArraysWithDedup(existing: string[], proposed: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of existing) {
    const key = normalize(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  for (const item of proposed) {
    const key = normalize(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

/**
 * Merge narrative fields.
 * Use proposed if provided, otherwise preserve existing (prevents data loss).
 */
function mergeNarrative(existing?: Narrative, proposed?: Narrative): Narrative | undefined {
  if (!existing && !proposed) return undefined
  if (!existing) return proposed
  if (!proposed) return existing

  const merged: Narrative = {}
  const fields: Array<keyof Narrative> = ['dependencies', 'examples', 'highlights', 'rules', 'structure']

  for (const field of fields) {
    const value = proposed[field] ?? existing[field]
    if (value !== undefined) {
      // Type assertion needed due to heterogeneous union (string | Array)
      ;(merged as Record<string, unknown>)[field] = value
    }
  }

  // Diagrams: union merge by content
  const existingDiagrams = existing.diagrams ?? []
  const proposedDiagrams = proposed.diagrams ?? []
  if (existingDiagrams.length > 0 || proposedDiagrams.length > 0) {
    const seen = new Set(existingDiagrams.map((d) => normalize(d.content)))
    const mergedDiagrams = [...existingDiagrams]
    for (const diagram of proposedDiagrams) {
      if (!seen.has(normalize(diagram.content))) {
        mergedDiagrams.push(diagram)
      }
    }

    merged.diagrams = mergedDiagrams
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Merge rawConcept fields.
 * Scalars: use proposed if provided, otherwise preserve existing.
 * Arrays (changes, files): union merge with deduplication.
 */
function mergeRawConcept(existing?: RawConcept, proposed?: RawConcept): RawConcept | undefined {
  if (!existing && !proposed) return undefined
  if (!existing) return proposed
  if (!proposed) return existing

  const merged: RawConcept = {}

  // Scalar fields: proposed wins, fall back to existing
  const scalarFields: Array<keyof RawConcept> = ['author', 'flow', 'task', 'timestamp']
  for (const field of scalarFields) {
    const value = proposed[field] ?? existing[field]
    if (value !== undefined) {
      ;(merged as Record<string, unknown>)[field] = value
    }
  }

  // patterns: proposed wins, fall back to existing
  merged.patterns = proposed.patterns ?? existing.patterns

  // Array fields: union merge
  const mergedChanges = mergeArraysWithDedup(existing.changes ?? [], proposed.changes ?? [])
  if (mergedChanges.length > 0) merged.changes = mergedChanges

  const mergedFiles = mergeArraysWithDedup(existing.files ?? [], proposed.files ?? [])
  if (mergedFiles.length > 0) merged.files = mergedFiles

  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Auto-resolve structural loss by merging existing content into proposed content.
 *
 * Resolution strategy:
 * - Arrays (snippets, relations, changes, files): Union merge with deduplication
 * - Scalars (narrative fields, rawConcept scalars): Proposed wins; preserve existing if proposed empty
 *
 * Only runs when `loss.hasLoss` is true. When no loss is detected, returns proposed as-is.
 *
 * @param existing - Parsed content from the existing file (before update)
 * @param proposed - Proposed new content from the curate operation
 * @param loss - Structural loss summary from detectStructuralLoss
 * @returns Resolved content with lost items merged back in
 */
export function resolveStructuralLoss(
  existing: ContextData,
  proposed: ContextData,
  loss: StructuralLoss,
): ContextData {
  if (!loss.hasLoss) return proposed

  return {
    ...proposed,
    narrative: mergeNarrative(existing.narrative, proposed.narrative),
    rawConcept: mergeRawConcept(existing.rawConcept, proposed.rawConcept),
    relations: mergeArraysWithDedup(existing.relations ?? [], proposed.relations ?? []),
    snippets: mergeArraysWithDedup(existing.snippets ?? [], proposed.snippets ?? []),
  }
}
