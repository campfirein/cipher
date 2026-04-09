import {existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve, sep} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKTREE_LINK_METADATA, WORKTREES_DIR} from '../../constants.js'
import {WorktreeLinkMetadataSchema, WorktreePointerSchema} from '../../core/domain/project/worktrees-schema.js'
import {resolvePath} from '../../utils/path-utils.js'

// ============================================================================
// ProjectResolution
// ============================================================================

/**
 * Result of canonical project resolution.
 */
export interface ProjectResolution {
  /** Directory containing .brv/config.json */
  projectRoot: string
  /** How the project root was discovered */
  source: 'direct' | 'flag' | 'linked'
  /** Worktree root (equals projectRoot when direct, equals cwd when linked) */
  worktreeRoot: string
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when a .brv pointer file points to a project root that no longer has .brv/.
 */
export class BrokenWorktreePointerError extends Error {
  constructor(
    public readonly pointerDir: string,
    public readonly targetProjectRoot: string,
  ) {
    super(
      `Worktree pointer broken: "${targetProjectRoot}" no longer has ${BRV_DIR}/${PROJECT_CONFIG_FILE}. ` +
        `Run 'brv worktree remove' to remove the pointer.`,
    )
    this.name = 'BrokenWorktreePointerError'
  }
}

/**
 * Error thrown when a .brv file (pointer) exists but contains malformed/invalid content.
 */
export class MalformedWorktreePointerError extends Error {
  constructor(
    public readonly pointerDir: string,
    public readonly reason: string,
  ) {
    super(
      `Worktree pointer in "${pointerDir}" is malformed: ${reason}. ` +
        `Fix the .brv file or run 'brv worktree remove' to remove it.`,
    )
    this.name = 'MalformedWorktreePointerError'
  }
}

// ============================================================================
// Core helpers
// ============================================================================

export function hasBrvConfig(dir: string): boolean {
  return existsSync(join(dir, BRV_DIR, PROJECT_CONFIG_FILE))
}

/**
 * Checks if a directory is a git root (.git directory or .git file for worktrees/submodules).
 */
export function isGitRoot(dir: string): boolean {
  const gitPath = join(dir, '.git')
  try {
    const stat = lstatSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
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
 * Checks if .brv in the given directory is a FILE (pointer), not a directory.
 */
export function isWorktreePointer(dir: string): boolean {
  const brvPath = join(dir, BRV_DIR)
  try {
    return lstatSync(brvPath).isFile()
  } catch {
    return false
  }
}

/**
 * Reads and validates a .brv pointer file.
 * @throws MalformedWorktreePointerError if the file has invalid content
 */
export function readWorktreePointer(dir: string): string {
  const brvPath = join(dir, BRV_DIR)
  let raw: string
  try {
    raw = readFileSync(brvPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new MalformedWorktreePointerError(dir, `cannot read .brv file: ${message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new MalformedWorktreePointerError(dir, 'invalid JSON')
  }

  const result = WorktreePointerSchema.safeParse(json)
  if (!result.success) {
    throw new MalformedWorktreePointerError(dir, 'missing or invalid "projectRoot" field')
  }

  return result.data.projectRoot
}

// ============================================================================
// Resolver
// ============================================================================

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
 * Git-style resolution: walks up from cwd to find the nearest `.brv`
 * (file or directory), just like git walks up to find `.git`.
 *
 * 1. --project-root flag
 * 2. Walk up from cwd looking for .brv:
 *    a. .brv is a directory with config.json → source: 'direct'
 *    b. .brv is a file (pointer) → follow to parent → source: 'linked'
 * 3. null (no .brv found at cwd or any ancestor)
 *
 * The walk-up stops at the **first** .brv found — it does NOT skip past
 * a .brv to find a "better" one higher up. This prevents accidental
 * inheritance from stale .brv/ directories in ancestor directories.
 *
 * @throws BrokenWorktreePointerError if .brv file points to a missing project
 * @throws MalformedWorktreePointerError if .brv file has invalid content
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

  // Step 2: Walk up from cwd looking for .brv (file or directory)
  let current = startDir
  const root = resolve('/')

  while (current !== root) {
    const result = resolveAtDir(current)
    if (result !== undefined) {
      return result
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Also check root
  if (current !== startDir) {
    const result = resolveAtDir(current)
    if (result !== undefined) {
      return result
    }
  }

  // Step 3: No .brv found anywhere
  return null
}

/**
 * Check a single directory for .brv and resolve it.
 * Returns ProjectResolution, null (invalid .brv), or undefined (no .brv here, keep walking).
 */
function resolveAtDir(dir: string): null | ProjectResolution | undefined {
  const brvPath = join(dir, BRV_DIR)

  let stat
  try {
    stat = lstatSync(brvPath)
  } catch {
    // .brv doesn't exist here — keep walking
    return undefined
  }

  // .brv is a directory → real project
  if (stat.isDirectory()) {
    if (existsSync(join(brvPath, PROJECT_CONFIG_FILE))) {
      return {
        projectRoot: dir,
        source: 'direct',
        worktreeRoot: dir,
      }
    }

    // .brv/ exists but no config.json — stop here (don't walk past it)
    return null
  }

  // .brv is a file → pointer to parent project
  if (stat.isFile()) {
    const targetRoot = readWorktreePointer(dir)

    let canonicalTarget: string
    try {
      canonicalTarget = resolvePath(targetRoot)
    } catch {
      throw new BrokenWorktreePointerError(dir, targetRoot)
    }

    if (!hasBrvConfig(canonicalTarget)) {
      throw new BrokenWorktreePointerError(dir, canonicalTarget)
    }

    return {
      projectRoot: canonicalTarget,
      source: 'linked',
      worktreeRoot: dir,
    }
  }

  // .brv is something else — stop here
  return null
}

// ============================================================================
// Worktree CRUD operations
// ============================================================================

/**
 * Sanitize a path into a safe directory name for the worktrees registry.
 * Replaces path separators and special chars with dashes.
 */
function sanitizeWorktreeName(worktreePath: string, projectRoot: string): string {
  // Try to use relative path for readability, fall back to basename
  const name = worktreePath.startsWith(projectRoot + sep) || worktreePath.startsWith(projectRoot + '/') ? worktreePath.slice(projectRoot.length + 1) : basename(worktreePath);

  return name.replaceAll(/[/\\]/g, '-').replaceAll(/[^a-zA-Z0-9._-]/g, '-')
}

export interface AddWorktreeResult {
  backedUp?: boolean
  message: string
  success: boolean
}

/**
 * Register a worktree: writes .brv pointer file in the target directory
 * and creates a registry entry in the parent's .brv/worktrees/.
 *
 * If the target already has a .brv/ directory (e.g., auto-init'd), it is
 * backed up to .brv-backup/ and replaced with a pointer file.
 */
export function addWorktree(projectRoot: string, worktreePath: string, options?: {force?: boolean}): AddWorktreeResult {
  // Validate parent has .brv/config.json
  if (!hasBrvConfig(projectRoot)) {
    return {message: `"${projectRoot}" is not a ByteRover project (no .brv/config.json).`, success: false}
  }

  // Validate target directory exists
  if (!existsSync(worktreePath)) {
    return {message: `Target directory does not exist: ${worktreePath}`, success: false}
  }

  // Cannot add self
  if (worktreePath === projectRoot) {
    return {message: 'Cannot add the project root as its own worktree.', success: false}
  }

  const targetBrvPath = join(worktreePath, BRV_DIR)
  let backedUp = false

  try {
    const stat = lstatSync(targetBrvPath)

    if (stat.isFile()) {
      // Already a pointer — check if it points to the same parent
      try {
        const existingTarget = readWorktreePointer(worktreePath)
        const canonicalExisting = resolvePath(existingTarget)
        const canonicalProject = resolvePath(projectRoot)
        if (canonicalExisting === canonicalProject) {
          return {message: `Already registered as worktree of "${projectRoot}".`, success: true}
        }

        return {
          message: `"${worktreePath}" is already a worktree of "${canonicalExisting}". Remove it first with 'brv worktree remove'.`,
          success: false,
        }
      } catch {
        // Malformed pointer — overwrite below
      }
    }

    if (stat.isDirectory()) {
      // Existing .brv/ directory — back up and replace
      if (!options?.force) {
        return {
          message:
            `"${worktreePath}" has its own .brv/ project. Use --force to replace it with a worktree pointer. ` +
            'The existing .brv/ will be moved to .brv-backup/.',
          success: false,
        }
      }

      const backupPath = join(worktreePath, '.brv-backup')
      if (existsSync(backupPath)) {
        rmSync(backupPath, {force: true, recursive: true})
      }

      renameSync(targetBrvPath, backupPath)
      backedUp = true
    }
  } catch {
    // .brv doesn't exist — proceed
  }

  // Write .brv pointer file
  const pointerContent = JSON.stringify({projectRoot: resolvePath(projectRoot)}, null, 2) + '\n'
  writeFileSync(targetBrvPath, pointerContent, 'utf8')

  // Create registry entry in parent
  const name = sanitizeWorktreeName(worktreePath, projectRoot)
  const worktreeDir = join(projectRoot, BRV_DIR, WORKTREES_DIR, name)
  mkdirSync(worktreeDir, {recursive: true})
  const metadata = {
    addedAt: new Date().toISOString(),
    worktreePath: resolvePath(worktreePath),
  }
  writeFileSync(join(worktreeDir, WORKTREE_LINK_METADATA), JSON.stringify(metadata, null, 2) + '\n', 'utf8')

  const msg = backedUp
    ? `Added worktree "${worktreePath}" (existing .brv/ backed up to .brv-backup/).`
    : `Added worktree "${worktreePath}".`

  return {backedUp, message: msg, success: true}
}

export interface RemoveWorktreeResult {
  message: string
  success: boolean
}

/**
 * Remove a worktree: deletes the .brv pointer file and cleans up the registry entry.
 * If a .brv-backup/ exists, restores it.
 */
export function removeWorktree(worktreePath: string): RemoveWorktreeResult {
  const brvPath = join(worktreePath, BRV_DIR)

  // Verify .brv is a pointer file
  try {
    const stat = lstatSync(brvPath)
    if (!stat.isFile()) {
      return {message: `"${worktreePath}" is not a worktree (has .brv/ directory, not pointer file).`, success: false}
    }
  } catch {
    return {message: `No .brv found in "${worktreePath}".`, success: false}
  }

  // Read pointer to find parent
  let projectRoot: string
  try {
    projectRoot = readWorktreePointer(worktreePath)
    projectRoot = resolvePath(projectRoot)
  } catch {
    // Can't read pointer — just delete the file
    unlinkSync(brvPath)
    return {message: `Removed worktree pointer (parent project unknown).`, success: true}
  }

  // Delete pointer file
  unlinkSync(brvPath)

  // Restore backup if exists
  const backupPath = join(worktreePath, '.brv-backup')
  if (existsSync(backupPath)) {
    renameSync(backupPath, brvPath)
  }

  // Clean up registry entry in parent
  const worktreesDir = join(projectRoot, BRV_DIR, WORKTREES_DIR)
  if (existsSync(worktreesDir)) {
    try {
      const entries = readdirSync(worktreesDir, {withFileTypes: true})
      const canonicalWorktree = resolvePath(worktreePath)
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const metaPath = join(worktreesDir, entry.name, WORKTREE_LINK_METADATA)
        if (!existsSync(metaPath)) continue
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
          const parsed = WorktreeLinkMetadataSchema.safeParse(meta)
          if (parsed.success && resolvePath(parsed.data.worktreePath) === canonicalWorktree) {
            rmSync(join(worktreesDir, entry.name), {force: true, recursive: true})
            break
          }
        } catch {
          // Malformed metadata — skip
        }
      }
    } catch {
      // Registry cleanup is best-effort
    }
  }

  return {message: `Removed worktree "${worktreePath}".`, success: true}
}

export interface WorktreeInfo {
  name: string
  worktreePath: string
}

/**
 * List all registered worktrees for a project by scanning .brv/worktrees/ entries.
 */
export function listWorktrees(projectRoot: string): WorktreeInfo[] {
  const worktreesDir = join(projectRoot, BRV_DIR, WORKTREES_DIR)
  if (!existsSync(worktreesDir)) {
    return []
  }

  const result: WorktreeInfo[] = []
  try {
    const entries = readdirSync(worktreesDir, {withFileTypes: true})
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metaPath = join(worktreesDir, entry.name, WORKTREE_LINK_METADATA)
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
        const parsed = WorktreeLinkMetadataSchema.safeParse(meta)
        if (parsed.success) {
          result.push({
            name: entry.name,
            worktreePath: parsed.data.worktreePath,
          })
        }
      } catch {
        // Skip malformed entries
      }
    }
  } catch {
    // Directory unreadable
  }

  return result
}

/**
 * Walk up from startDir looking for the nearest directory with .brv/ DIRECTORY
 * (not a .brv file). Used only by `brv worktree add` auto-detect mode.
 * NOT used by the resolver.
 */
export function findParentProject(startDir: string): string | undefined {
  let current: string
  try {
    current = resolvePath(startDir)
  } catch {
    return undefined
  }

  // Skip cwd itself — we're looking for a PARENT
  current = dirname(current)
  const root = resolve('/')

  while (current !== root) {
    const brvPath = join(current, BRV_DIR)
    try {
      const stat = lstatSync(brvPath)
      if (stat.isDirectory() && existsSync(join(brvPath, PROJECT_CONFIG_FILE))) {
        return current
      }
    } catch {
      // .brv doesn't exist here
    }

    if (isGitRoot(current)) {
      break
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Check the boundary directory itself
  if (current !== startDir) {
    const brvPath = join(current, BRV_DIR)
    try {
      const stat = lstatSync(brvPath)
      if (stat.isDirectory() && existsSync(join(brvPath, PROJECT_CONFIG_FILE))) {
        return current
      }
    } catch {
      // Not found
    }
  }

  return undefined
}
