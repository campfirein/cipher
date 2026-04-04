import {existsSync, realpathSync} from 'node:fs'
import {join, relative} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../constants.js'
import {loadWorkspacesFile, writeWorkspacesFile} from './workspaces-schema.js'

export interface OperationResult {
  message: string
  success: boolean
}

/**
 * Add a workspace entry to `.brv/workspaces.json`.
 * Computes relative path from projectRoot to targetPath.
 * Validates target is a brv project and prevents duplicates.
 */
export function addWorkspace(projectRoot: string, targetPath: string): OperationResult {
  if (!existsSync(targetPath)) {
    return {message: `Target path does not exist: ${targetPath}`, success: false}
  }

  let canonicalProject: string
  let canonicalTarget: string
  try {
    canonicalProject = realpathSync(projectRoot)
    canonicalTarget = realpathSync(targetPath)
  } catch {
    return {message: `Cannot resolve paths`, success: false}
  }

  // Self-link check
  if (canonicalProject === canonicalTarget) {
    return {message: 'Cannot link to self', success: false}
  }

  // Validate target is a brv project
  const targetConfig = join(canonicalTarget, BRV_DIR, PROJECT_CONFIG_FILE)
  if (!existsSync(targetConfig)) {
    return {message: `Target is not a ByteRover project (missing ${BRV_DIR}/${PROJECT_CONFIG_FILE})`, success: false}
  }

  // Compute relative path
  const relativePath = relative(canonicalProject, canonicalTarget)

  // Load existing or start fresh
  const existing = loadWorkspacesFile(projectRoot) ?? []

  // Dedup check — compare resolved paths
  for (const entry of existing) {
    try {
      const resolved = realpathSync(join(canonicalProject, entry))
      if (resolved === canonicalTarget) {
        return {message: `Workspace already linked: ${entry}`, success: false}
      }
    } catch {
      // Broken entry — skip
    }
  }

  existing.push(relativePath)
  writeWorkspacesFile(projectRoot, existing)

  return {message: `Added workspace: ${relativePath}`, success: true}
}

/**
 * Remove a workspace entry from `.brv/workspaces.json`.
 * Matches by relative path string or by resolving absolute path.
 */
export function removeWorkspace(projectRoot: string, path: string): OperationResult {
  const existing = loadWorkspacesFile(projectRoot)
  if (!existing || existing.length === 0) {
    return {message: 'No workspaces configured', success: false}
  }

  let canonicalProject: string
  try {
    canonicalProject = realpathSync(projectRoot)
  } catch {
    return {message: 'Cannot resolve project root', success: false}
  }

  // Try to resolve the input path to canonical form
  let canonicalInput: string | undefined
  try {
    // If it's a relative path, resolve against project root
    const resolved = join(canonicalProject, path)
    if (existsSync(resolved)) {
      canonicalInput = realpathSync(resolved)
    } else if (existsSync(path)) {
      canonicalInput = realpathSync(path)
    }
  } catch {
    // Can't resolve — will try string match
  }

  const idx = existing.findIndex((entry) => {
    // Direct string match
    if (entry === path) return true

    // Canonical path match
    if (canonicalInput) {
      try {
        const resolved = realpathSync(join(canonicalProject, entry))
        return resolved === canonicalInput
      } catch {
        // Broken entry
      }
    }

    return false
  })

  if (idx === -1) {
    return {message: `Workspace not found: ${path}`, success: false}
  }

  const removed = existing.splice(idx, 1)[0]
  writeWorkspacesFile(projectRoot, existing)

  return {message: `Removed workspace: ${removed}`, success: true}
}
