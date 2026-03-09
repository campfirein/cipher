/**
 * Snapshot diff utility for detecting context tree changes.
 *
 * Compares pre/post snapshot states to produce a list of changed paths.
 * Used by CurateExecutor to determine which summaries need regeneration.
 */

import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'

import {isExcludedFromSync} from './derived-artifact.js'

/**
 * Compare two snapshot states and return all changed paths.
 *
 * Returns paths that are:
 * - Added: present in `after` but not in `before`
 * - Modified: present in both but with different hashes
 * - Deleted: present in `before` but not in `after`
 *
 * Derived artifacts (via isExcludedFromSync) are excluded from results
 * since they are generated content that should not trigger summary regeneration.
 */
export function diffStates(before: Map<string, FileState>, after: Map<string, FileState>): string[] {
  const changedPaths: string[] = []

  // Detect additions and modifications
  for (const [path, afterState] of after) {
    if (isExcludedFromSync(path)) continue

    const beforeState = before.get(path)
    if (!beforeState || beforeState.hash !== afterState.hash) {
      changedPaths.push(path)
    }
  }

  // Detect deletions
  for (const path of before.keys()) {
    if (isExcludedFromSync(path)) continue

    if (!after.has(path)) {
      changedPaths.push(path)
    }
  }

  return changedPaths
}
