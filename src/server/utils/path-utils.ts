import {createHash} from 'node:crypto'
import {realpathSync} from 'node:fs'
import {join} from 'node:path'

import {GLOBAL_PROJECTS_DIR} from '../constants.js'
import {getGlobalDataDir} from './global-data-path.js'

/**
 * Resolves a file path to its canonical form via realpath.
 *
 * On case-insensitive filesystems (default macOS APFS), realpathSync
 * already returns the canonical case as stored on disk, so no additional
 * normalization is needed.
 *
 * @param inputPath - The path to resolve
 * @returns Canonical absolute path
 */
export const resolvePath = (inputPath: string): string => realpathSync(inputPath)

/**
 * Characters illegal in Windows file/directory names, mapped to percent-encoded form.
 */
const WINDOWS_ILLEGAL_CHARS: ReadonlyMap<string, string> = new Map([
  ['"', '%22'],
  ['*', '%2A'],
  [':', '%3A'],
  ['<', '%3C'],
  ['>', '%3E'],
  ['?', '%3F'],
  ['|', '%7C'],
])

/**
 * Maximum length for the sanitized directory name.
 * Leaves headroom for the parent path (~60 chars) and child files,
 * safely under the 255-byte single-component limit on all major filesystems.
 */
const MAX_SANITIZED_LENGTH = 200

/** Length of the hex hash suffix used when truncating long names. */
const HASH_SUFFIX_LENGTH = 12

/**
 * Converts a resolved absolute path into a safe, collision-free directory name.
 *
 * Splits on path separators, percent-encodes `%`, `--`, and characters illegal
 * on Windows within each component, then joins with `--`.
 * The encoding step guarantees injectivity: different resolved paths always
 * produce different names.
 *
 * If the result exceeds {@link MAX_SANITIZED_LENGTH}, it is truncated and a
 * SHA-256 hash suffix is appended (separated by `---`) to preserve uniqueness.
 *
 * @param resolvedPath - A resolved absolute path (output of resolvePath)
 * @returns A safe directory name string
 */
export const sanitizeProjectPath = (resolvedPath: string): string => {
  let normalized = resolvedPath

  // Remove Windows drive colon (C:\foo → C\foo)
  normalized = normalized.replace(/^([A-Za-z]):/, '$1')

  // Split on path separators, filter empty components
  const components = normalized.split(/[/\\]+/).filter(Boolean)

  // Percent-encode special characters within each component to preserve injectivity.
  // '%' is encoded first to prevent double-encoding.
  const encoded = components.map((c) => {
    let result = c.replaceAll('%', '%25').replaceAll('--', '%2D%2D')
    for (const [char, replacement] of WINDOWS_ILLEGAL_CHARS) {
      result = result.replaceAll(char, replacement)
    }

    return result
  })

  const joined = encoded.join('--')

  if (joined.length <= MAX_SANITIZED_LENGTH) {
    return joined
  }

  // Truncate with hash suffix to maintain uniqueness.
  // '---' (triple dash) is unambiguous: '--' within components is encoded to '%2D%2D',
  // so '---' cannot appear in the non-truncated output.
  const hash = createHash('sha256').update(joined).digest('hex').slice(0, HASH_SUFFIX_LENGTH)
  const prefixLength = MAX_SANITIZED_LENGTH - HASH_SUFFIX_LENGTH - 3
  return joined.slice(0, prefixLength) + '---' + hash
}

/**
 * Returns the per-project data directory for a given working directory.
 *
 * Maps a client CWD to: ~/.local/share/brv/projects/<sanitized-path>/
 *
 * @param cwd - The client's working directory
 * @returns Absolute path to the project's data directory
 */
export const getProjectDataDir = (cwd: string): string => {
  const resolved = resolvePath(cwd)
  const sanitized = sanitizeProjectPath(resolved)
  return join(getGlobalDataDir(), GLOBAL_PROJECTS_DIR, sanitized)
}
