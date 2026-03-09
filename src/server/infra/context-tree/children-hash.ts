/**
 * Children hash utility for summary staleness detection.
 *
 * Computes a deterministic hash from child paths and their content hashes.
 * Including paths (not just content hashes) ensures that renames and moves
 * are detected as structural changes.
 */

import {computeContentHash} from './hash-utils.js'

/**
 * Compute a deterministic hash of children for staleness detection.
 *
 * The hash includes both the relative path and content hash of each child,
 * sorted by path for determinism. This detects:
 * - Content changes (different contentHash)
 * - Renames/moves (different path, same contentHash)
 * - Additions/deletions (different set of paths)
 */
export function computeChildrenHash(children: Array<{contentHash: string; path: string}>): string {
  const sorted = [...children].sort((a, b) => a.path.localeCompare(b.path))
  const input = sorted.map((c) => `${c.path}:${c.contentHash}`).join('\n')

  return computeContentHash(input)
}
