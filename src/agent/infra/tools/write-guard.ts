import {realpathSync} from 'node:fs'
import {resolve} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../server/constants.js'
import {loadKnowledgeLinks} from '../../../server/core/domain/knowledge/knowledge-link-schema.js'

const canonicalize = (path: string): string => {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

const isWithin = (candidatePath: string, rootPath: string): boolean =>
  candidatePath === rootPath || candidatePath.startsWith(rootPath + '/')

/**
 * Validates that a write target path is within the local project's context tree,
 * not inside any knowledge-linked project's context tree.
 *
 * Knowledge-linked sources are read-only — agents must never write to them.
 *
 * @param targetPath - Absolute path being written to
 * @param projectRoot - The local project root (owns .brv/)
 * @returns null if write is allowed, or an error message string if blocked
 */
export function validateWriteTarget(targetPath: string, projectRoot: string): null | string {
  const localContextTree = resolve(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)

  const canonicalLocalContextTree = canonicalize(localContextTree)
  const canonicalTarget = canonicalize(targetPath)

  if (isWithin(canonicalTarget, canonicalLocalContextTree)) {
    return null
  }

  // Load knowledge links to get linked context tree roots
  const loaded = loadKnowledgeLinks(projectRoot)
  for (const source of loaded?.sources ?? []) {
    const canonicalLinkedRoot = canonicalize(source.contextTreeRoot)
    if (isWithin(canonicalTarget, canonicalLinkedRoot)) {
      const alias = source.alias ?? source.sourceKey
      return `Cannot write to knowledge-linked project "${alias}" — linked sources are read-only. Only the local context tree (${localContextTree}) is writable.`
    }
  }

  return `Cannot write outside the local context tree. Only the local context tree (${localContextTree}) is writable.`
}
