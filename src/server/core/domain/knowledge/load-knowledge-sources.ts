import {statSync} from 'node:fs'
import {join} from 'node:path'

import type {LoadedKnowledgeSources} from './knowledge-source.js'

import {BRV_DIR, WORKSPACES_FILE} from '../../../constants.js'
import {resolveWorkspaces} from './workspaces-resolver.js'
import {loadWorkspacesFile} from './workspaces-schema.js'

/**
 * Loads `.brv/workspaces.json` and resolves all workspace entries into KnowledgeSource[].
 *
 * Returns null if `workspaces.json` does not exist.
 * Tracks mtime of `workspaces.json` for cache invalidation.
 */
export function loadKnowledgeSources(projectRoot: string): LoadedKnowledgeSources | null {
  const workspaces = loadWorkspacesFile(projectRoot)
  if (workspaces === null) {
    return null
  }

  const filePath = join(projectRoot, BRV_DIR, WORKSPACES_FILE)
  let mtime = 0
  try {
    mtime = statSync(filePath).mtimeMs
  } catch {
    // File may have been deleted between load and stat
  }

  const sources = resolveWorkspaces(projectRoot, workspaces)

  return {mtime, sources}
}
