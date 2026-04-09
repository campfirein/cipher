import {existsSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, resolve, sep} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKTREE_LINK_FILE} from '../../constants.js'
import {WorktreeLinkSchema} from '../../core/domain/project/worktree-link-schema.js'
import {resolvePath} from '../../utils/path-utils.js'

/**
 * Result of canonical project resolution.
 */
export interface ProjectResolution {
  /** File path of the link file (if source is 'linked') */
  linkFile?: string
  /** Directory containing .brv/config.json */
  projectRoot: string
  /** True if cwd has both .brv/config.json and .brv-worktree.json */
  shadowedLink?: boolean
  /** How the project root was discovered */
  source: 'direct' | 'flag' | 'linked' | 'walked-up'
  /** Stable linked workspace root, or projectRoot if unlinked */
  worktreeRoot: string
}

/**
 * Error thrown when a worktree link file points to a project root that no longer has .brv/.
 */
export class BrokenWorktreeLinkError extends Error {
  constructor(
    public readonly linkFile: string,
    public readonly targetProjectRoot: string,
  ) {
    super(
      `Worktree link broken: "${targetProjectRoot}" no longer has ${BRV_DIR}/${PROJECT_CONFIG_FILE}. ` +
        `Run 'brv worktree remove' to remove the stale link file at "${linkFile}".`,
    )
    this.name = 'BrokenWorktreeLinkError'
  }
}

/**
 * Error thrown when a .brv-worktree.json file exists but contains malformed/invalid content.
 */
export class MalformedWorktreeLinkError extends Error {
  constructor(
    public readonly linkFile: string,
    public readonly reason: string,
  ) {
    super(
      `Worktree link file "${linkFile}" is malformed: ${reason}. ` +
        `Fix the file or run 'brv worktree remove' to remove it.`,
    )
    this.name = 'MalformedWorktreeLinkError'
  }
}

export function hasBrvConfig(dir: string): boolean {
  return existsSync(join(dir, BRV_DIR, PROJECT_CONFIG_FILE))
}

export function hasWorktreeLink(dir: string): boolean {
  return existsSync(join(dir, WORKTREE_LINK_FILE))
}

/**
 * Checks if a directory is a git root (.git directory or .git file for worktrees/submodules).
 */
export function isGitRoot(dir: string): boolean {
  const gitPath = join(dir, '.git')
  try {
    const stat = statSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

/**
 * Reads and validates a .brv-worktree.json file.
 * @throws MalformedWorktreeLinkError if the file exists but contains invalid content
 */
function readWorktreeLink(linkFilePath: string): string {
  let raw: string
  try {
    raw = readFileSync(linkFilePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new MalformedWorktreeLinkError(linkFilePath, `cannot read file: ${message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new MalformedWorktreeLinkError(linkFilePath, 'invalid JSON')
  }

  const result = WorktreeLinkSchema.safeParse(json)
  if (!result.success) {
    throw new MalformedWorktreeLinkError(linkFilePath, 'missing or invalid "projectRoot" field')
  }

  return result.data.projectRoot
}

/**
 * Checks that candidate is an ancestor of (or equal to) descendant.
 * Both paths must be absolute.
 */
export function isDescendantOf(descendant: string, ancestor: string): boolean {
  const normalizedAncestor = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  return descendant === ancestor || descendant.startsWith(normalizedAncestor)
}

/**
 * Validates and resolves a worktree link file, returning a ProjectResolution.
 * @throws BrokenWorktreeLinkError if the link target is invalid
 */
function resolveWorktreeLink(linkFile: string, workspaceDir: string): ProjectResolution {
  const targetRoot = readWorktreeLink(linkFile)

  let canonicalTarget: string
  try {
    canonicalTarget = resolvePath(targetRoot)
  } catch {
    throw new BrokenWorktreeLinkError(linkFile, targetRoot)
  }

  if (!hasBrvConfig(canonicalTarget)) {
    throw new BrokenWorktreeLinkError(linkFile, canonicalTarget)
  }

  if (!isDescendantOf(workspaceDir, canonicalTarget)) {
    throw new BrokenWorktreeLinkError(linkFile, canonicalTarget)
  }

  return {
    linkFile,
    projectRoot: canonicalTarget,
    source: 'linked',
    worktreeRoot: workspaceDir,
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
 * 3. nearest .brv-worktree.json at cwd/ancestor (linked)
 * 4. walked-up .brv/config.json (walked-up)
 * 5. null (no project found)
 *
 * @throws BrokenWorktreeLinkError if a worktree link points to a missing project
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
      worktreeRoot: canonical,
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
    const shadowedLink = hasWorktreeLink(startDir) || undefined
    return {
      projectRoot: startDir,
      shadowedLink,
      source: 'direct',
      worktreeRoot: startDir,
    }
  }

  // Step 3: Walk up looking for .brv-worktree.json (linked)
  // Also walk up for .brv/config.json (walked-up) simultaneously,
  // but nearest .brv-worktree.json takes priority.
  let current = startDir
  let walkedUpRoot: string | undefined
  const root = resolve('/')

  while (current !== root) {
    // Check for worktree link
    if (hasWorktreeLink(current)) {
      const linkFile = join(current, WORKTREE_LINK_FILE)

      return resolveWorktreeLink(linkFile, current)
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
      worktreeRoot: walkedUpRoot,
    }
  }

  // Step 5: null
  return null
}

/**
 * Finds the nearest .brv-worktree.json file at cwd or any ancestor.
 * Used by `brv worktree remove` to bypass the resolver and directly locate the link file.
 */
export function findNearestWorktreeLink(cwd?: string): null | string {
  let current: string
  try {
    current = resolvePath(cwd ?? process.cwd())
  } catch {
    return null
  }

  const root = resolve('/')

  while (current !== root) {
    const linkFile = join(current, WORKTREE_LINK_FILE)
    if (existsSync(linkFile)) {
      return linkFile
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}
