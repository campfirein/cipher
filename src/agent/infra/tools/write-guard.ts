import {realpathSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../server/constants.js'
import {loadSources} from '../../../server/core/domain/source/source-schema.js'
import {isDescendantOf} from '../../../server/utils/path-utils.js'

const canonicalize = (path: string): string => {
  try {
    return realpathSync(resolve(path))
  } catch {
    // For non-existent files, try canonicalizing the parent
    try {
      const parent = dirname(resolve(path))
      return join(realpathSync(parent), basename(path))
    } catch {
      return resolve(path)
    }
  }
}

/**
 * Validates that a write target path is within the local project's context tree,
 * not inside any shared knowledge source's context tree.
 *
 * Shared sources are read-only — agents must never write to them.
 *
 * @param targetPath - Absolute path being written to
 * @param projectRoot - The local project root (owns .brv/)
 * @returns null if write is allowed, or an error message string if blocked
 */
export function validateWriteTarget(targetPath: string, projectRoot: string): null | string {
  const localContextTree = resolve(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)

  const canonicalLocalContextTree = canonicalize(localContextTree)
  const canonicalTarget = canonicalize(targetPath)

  if (isDescendantOf(canonicalTarget, canonicalLocalContextTree)) {
    return null
  }

  // Load sources to get shared context tree roots
  const loaded = loadSources(projectRoot)
  for (const origin of loaded?.origins ?? []) {
    const canonicalSharedRoot = canonicalize(origin.contextTreeRoot)
    if (isDescendantOf(canonicalTarget, canonicalSharedRoot)) {
      const alias = origin.alias ?? origin.originKey
      return `Cannot write to shared source "${alias}" — sources are read-only. Only the local context tree (${localContextTree}) is writable.`
    }
  }

  return `Cannot write outside the local context tree. Only the local context tree (${localContextTree}) is writable.`
}
