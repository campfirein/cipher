import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import {BRV_DIR, WORKSPACES_FILE} from '../../../constants.js'

const WorkspacesFileSchema = z.array(z.string())

/**
 * Loads `.brv/workspaces.json` from a project root.
 *
 * Returns null if the file does not exist.
 * Returns empty array if the file is malformed or invalid.
 */
export function loadWorkspacesFile(projectRoot: string): null | string[] {
  const filePath = join(projectRoot, BRV_DIR, WORKSPACES_FILE)

  if (!existsSync(filePath)) {
    return null
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }

  const result = WorkspacesFileSchema.safeParse(raw)
  if (!result.success) {
    return []
  }

  return result.data
}

/**
 * Writes `.brv/workspaces.json` with pretty JSON.
 */
export function writeWorkspacesFile(projectRoot: string, workspaces: string[]): void {
  const filePath = join(projectRoot, BRV_DIR, WORKSPACES_FILE)
  writeFileSync(filePath, JSON.stringify(workspaces, null, 2) + '\n', 'utf8')
}
