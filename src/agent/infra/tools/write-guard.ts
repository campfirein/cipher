import {existsSync, realpathSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../server/constants.js'
import {loadKnowledgeSources} from '../../../server/core/domain/knowledge/load-knowledge-sources.js'

/**
 * Validates whether a write target is allowed.
 *
 * Returns `null` if the write is allowed, or an error message string if blocked.
 *
 * Rules:
 * - Writes to the local `.brv/context-tree/` are allowed
 * - Writes to any linked project's context tree are blocked
 * - Writes outside the local context tree are blocked
 */
export function validateWriteTarget(targetPath: string, projectRoot: string): null | string {
  if (!projectRoot) {
    return null
  }

  const localContextTree = resolve(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)

  const canonicalTarget = tryRealpath(resolve(targetPath))
  const canonicalLocal = tryRealpath(localContextTree)

  // Allow writes within local context tree
  if (isWithin(canonicalTarget, canonicalLocal)) {
    return null
  }

  // Block writes to any linked project's context tree
  const loaded = loadKnowledgeSources(projectRoot)
  for (const source of loaded?.sources ?? []) {
    const canonicalLinkedRoot = tryRealpath(source.contextTreeRoot)

    if (isWithin(canonicalTarget, canonicalLinkedRoot)) {
      return `Cannot write to knowledge-linked project "${source.alias ?? 'unknown'}". Linked context trees are read-only.`
    }
  }

  // Block writes outside local context tree
  return `Cannot write outside local context tree: ${join(BRV_DIR, CONTEXT_TREE_DIR)}`
}

/**
 * Resolves symlinks in a path. If the path doesn't exist,
 * walks up to the nearest existing ancestor and resolves that,
 * then appends the remaining segments. Handles macOS /tmp → /private/tmp.
 */
function tryRealpath(p: string): string {
  if (existsSync(p)) {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }

  // Walk up to find the nearest existing ancestor
  const parent = dirname(p)
  if (parent === p) {
    return p // root
  }

  const resolvedParent = tryRealpath(parent)
  return join(resolvedParent, basename(p))
}

function isWithin(target: string, parent: string): boolean {
  const rel = relative(parent, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
