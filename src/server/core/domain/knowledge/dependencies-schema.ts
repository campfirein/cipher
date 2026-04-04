import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import {BRV_DIR, CONTEXT_TREE_DIR, DEPENDENCIES_FILE} from '../../../constants.js'

const DependenciesFileSchema = z.record(z.string(), z.string())

/**
 * Loads `.brv/context-tree/dependencies.json` from a project root.
 *
 * Returns null if the file does not exist.
 * Returns empty object if the file is malformed or invalid.
 */
export function loadDependenciesFile(projectRoot: string): null | Record<string, string> {
  const filePath = join(projectRoot, BRV_DIR, CONTEXT_TREE_DIR, DEPENDENCIES_FILE)

  if (!existsSync(filePath)) {
    return null
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }

  const result = DependenciesFileSchema.safeParse(raw)
  if (!result.success) {
    return {}
  }

  return result.data
}

/**
 * Writes `.brv/context-tree/dependencies.json` with pretty JSON.
 */
export function writeDependenciesFile(projectRoot: string, deps: Record<string, string>): void {
  const filePath = join(projectRoot, BRV_DIR, CONTEXT_TREE_DIR, DEPENDENCIES_FILE)
  writeFileSync(filePath, JSON.stringify(deps, null, 2) + '\n', 'utf8')
}
