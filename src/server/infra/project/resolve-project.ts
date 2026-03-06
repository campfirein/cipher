import {existsSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, resolve, sep} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKSPACE_LINK_FILE} from '../../constants.js'
import {WorkspaceLinkSchema} from '../../core/domain/project/workspace-link-schema.js'
import {resolvePath} from '../../utils/path-utils.js'

/**
 * Result of canonical project resolution.
 */
export interface ProjectResolution {
  /** File path of the link file (if source is 'linked') */
  linkFile?: string
  /** Directory containing .brv/config.json */
  projectRoot: string
  /** True if cwd has both .brv/config.json and .brv-workspace.json */
  shadowedLink?: boolean
  /** How the project root was discovered */
  source: 'direct' | 'flag' | 'linked' | 'walked-up'
  /** Stable linked workspace root, or projectRoot if unlinked */
  workspaceRoot: string
}

/**
 * Error thrown when a workspace link file points to a project root that no longer has .brv/.
 */
export class BrokenWorkspaceLinkError extends Error {
  constructor(
    public readonly linkFile: string,
    public readonly targetProjectRoot: string,
  ) {
    super(
      `Workspace link broken: "${targetProjectRoot}" no longer has ${BRV_DIR}/${PROJECT_CONFIG_FILE}. ` +
        `Run 'brv unlink' to remove the stale link file at "${linkFile}".`,
    )
    this.name = 'BrokenWorkspaceLinkError'
  }
}

/**
 * Error thrown when a .brv-workspace.json file exists but contains malformed/invalid content.
 */
export class MalformedWorkspaceLinkError extends Error {
  constructor(
    public readonly linkFile: string,
    public readonly reason: string,
  ) {
    super(
      `Workspace link file "${linkFile}" is malformed: ${reason}. ` +
        `Fix the file or run 'brv unlink' to remove it.`,
    )
    this.name = 'MalformedWorkspaceLinkError'
  }
}

function hasBrvConfig(dir: string): boolean {
  return existsSync(join(dir, BRV_DIR, PROJECT_CONFIG_FILE))
}

function hasWorkspaceLink(dir: string): boolean {
  return existsSync(join(dir, WORKSPACE_LINK_FILE))
}

/**
 * Checks if a directory is a git root (.git directory or .git file for worktrees/submodules).
 */
function isGitRoot(dir: string): boolean {
  const gitPath = join(dir, '.git')
  try {
    const stat = statSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

/**
 * Reads and validates a .brv-workspace.json file.
 * @throws MalformedWorkspaceLinkError if the file exists but contains invalid content
 */
function readWorkspaceLink(linkFilePath: string): string {
  let raw: string
  try {
    raw = readFileSync(linkFilePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new MalformedWorkspaceLinkError(linkFilePath, `cannot read file: ${message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new MalformedWorkspaceLinkError(linkFilePath, 'invalid JSON')
  }

  const result = WorkspaceLinkSchema.safeParse(json)
  if (!result.success) {
    throw new MalformedWorkspaceLinkError(linkFilePath, 'missing or invalid "projectRoot" field')
  }

  return result.data.projectRoot
}

/**
 * Checks that candidate is an ancestor of (or equal to) descendant.
 * Both paths must be absolute.
 */
function isDescendantOf(descendant: string, ancestor: string): boolean {
  const normalizedAncestor = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  return descendant === ancestor || descendant.startsWith(normalizedAncestor)
}

/**
 * Validates and resolves a workspace link file, returning a ProjectResolution.
 * @throws BrokenWorkspaceLinkError if the link target is invalid
 */
function resolveWorkspaceLink(linkFile: string, workspaceDir: string): ProjectResolution {
  const targetRoot = readWorkspaceLink(linkFile)

  let canonicalTarget: string
  try {
    canonicalTarget = resolvePath(targetRoot)
  } catch {
    throw new BrokenWorkspaceLinkError(linkFile, targetRoot)
  }

  if (!hasBrvConfig(canonicalTarget)) {
    throw new BrokenWorkspaceLinkError(linkFile, canonicalTarget)
  }

  if (!isDescendantOf(workspaceDir, canonicalTarget)) {
    throw new BrokenWorkspaceLinkError(linkFile, canonicalTarget)
  }

  return {
    linkFile,
    projectRoot: canonicalTarget,
    source: 'linked',
    workspaceRoot: workspaceDir,
  }
}

export interface ResolveProjectOptions {
  /** Override cwd (defaults to process.cwd()) */
  cwd?: string
  /** Explicit --project-root flag value */
  projectRootFlag?: string
}

/**
 * Canonical project resolver — single source of truth for discovering
 * which .brv/ project a given working directory belongs to.
 *
 * Resolution priority:
 * 1. --project-root flag
 * 2. .brv/config.json at cwd (direct)
 * 3. nearest .brv-workspace.json at cwd/ancestor (linked)
 * 4. walked-up .brv/config.json (walked-up)
 * 5. null (no project found)
 *
 * @throws BrokenWorkspaceLinkError if a workspace link points to a missing project
 */
export function resolveProject(options?: ResolveProjectOptions): null | ProjectResolution {
  const cwd = options?.cwd ?? process.cwd()

  // Step 1: Explicit --project-root flag
  if (options?.projectRootFlag) {
    const flagRoot = resolve(options.projectRootFlag)
    if (!hasBrvConfig(flagRoot)) {
      return null
    }

    const canonical = resolvePath(flagRoot)
    return {
      projectRoot: canonical,
      source: 'flag',
      workspaceRoot: canonical,
    }
  }

  let startDir: string
  try {
    startDir = resolvePath(cwd)
  } catch {
    return null
  }

  // Step 2: .brv/config.json at cwd (direct)
  if (hasBrvConfig(startDir)) {
    const shadowedLink = hasWorkspaceLink(startDir) || undefined
    return {
      projectRoot: startDir,
      shadowedLink,
      source: 'direct',
      workspaceRoot: startDir,
    }
  }

  // Step 3: Walk up looking for .brv-workspace.json (linked)
  // Also walk up for .brv/config.json (walked-up) simultaneously,
  // but nearest .brv-workspace.json takes priority.
  let current = startDir
  let walkedUpRoot: string | undefined
  const root = resolve('/')

  while (current !== root) {
    // Check for workspace link
    if (hasWorkspaceLink(current)) {
      const linkFile = join(current, WORKSPACE_LINK_FILE)

      return resolveWorkspaceLink(linkFile, current)
    }

    // Check for .brv/config.json (walked-up candidate)
    if (!walkedUpRoot && hasBrvConfig(current)) {
      walkedUpRoot = current
    }

    // Stop at git root
    if (isGitRoot(current)) {
      break
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Also check the final directory (git root or filesystem root)
  if (!walkedUpRoot && current !== startDir && hasBrvConfig(current)) {
    walkedUpRoot = current
  }

  // Step 4: walked-up .brv/config.json
  if (walkedUpRoot) {
    return {
      projectRoot: walkedUpRoot,
      source: 'walked-up',
      workspaceRoot: walkedUpRoot,
    }
  }

  // Step 5: null
  return null
}

/**
 * Finds the nearest .brv-workspace.json file at cwd or any ancestor.
 * Used by `brv unlink` to bypass the resolver and directly locate the link file.
 */
export function findNearestWorkspaceLink(cwd?: string): null | string {
  let current: string
  try {
    current = resolvePath(cwd ?? process.cwd())
  } catch {
    return null
  }

  const root = resolve('/')

  while (current !== root) {
    const linkFile = join(current, WORKSPACE_LINK_FILE)
    if (existsSync(linkFile)) {
      return linkFile
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}
