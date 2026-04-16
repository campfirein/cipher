import {existsSync, readdirSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

/**
 * A provider discovered during environment scanning.
 */
export type DetectedProvider = {
  /** Whether this provider was auto-discovered */
  detected: boolean
  /** Environment variable name (for cloud providers) */
  envVar?: string
  /** Unique provider identifier */
  id: string
  /** Number of .md files found (for local providers) */
  noteCount?: number
  /** File system path (for local providers) */
  path?: string
  /** Local or cloud */
  type: 'cloud' | 'local'
}

/**
 * Options for provider detection.
 */
export type DetectProvidersOptions = {
  /** Override environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>
  /**
   * Roots to check for a GBrain CLI checkout (`src/cli.ts`).
   * Defaults to workspace sibling, home, and known workspace paths.
   * Pass a fixture path in tests; pass `[]` to force undetected.
   */
  gbrainCandidatePaths?: string[]
  /** Explicit markdown folder paths to check */
  markdownPaths?: string[]
  /** Directories to scan for Obsidian vaults and .md folders */
  searchPaths?: string[]
}

/**
 * Count .md files in a directory (non-recursive, capped at 10000).
 */
function countMarkdownFiles(dirPath: string): number {
  try {
    const entries = readdirSync(dirPath)

    return entries.filter((e) => e.endsWith('.md')).length
  } catch {
    return 0
  }
}

/**
 * Find Obsidian vaults by scanning for `.obsidian/` directories
 * in immediate children of the given search paths.
 */
function findObsidianVaults(searchPaths: string[]): DetectedProvider[] {
  const results: DetectedProvider[] = []

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue

    try {
      const entries = readdirSync(searchPath, {withFileTypes: true})
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = join(searchPath, entry.name)
        if (existsSync(join(candidate, '.obsidian'))) {
          results.push({
            detected: true,
            id: 'obsidian',
            noteCount: countMarkdownFiles(candidate),
            path: candidate,
            type: 'local',
          })
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return results
}

/**
 * Find markdown folders from explicit paths.
 */
function findMarkdownFolders(paths: string[]): DetectedProvider[] {
  const results: DetectedProvider[] = []

  for (const mdPath of paths) {
    if (!existsSync(mdPath)) continue

    const count = countMarkdownFiles(mdPath)
    if (count > 0) {
      results.push({
        detected: true,
        id: 'local-markdown',
        noteCount: count,
        path: mdPath,
        type: 'local',
      })
    }
  }

  return results
}

/**
 * Return sensible default paths for scanning on the current platform.
 * Exported for testability.
 */
export function getDefaultSearchPaths(): {markdownPaths: string[]; searchPaths: string[]} {
  const home = homedir()

  const searchPaths = [
    join(home, 'Documents'),
    home,
  ].filter((p) => existsSync(p))

  const markdownPaths = [
    join(home, 'notes'),
    join(home, 'Notes'),
    join(home, 'content-skill-graph'),
    join(home, 'Documents', 'notes'),
    join(home, 'Documents', 'Notes'),
  ].filter((p) => existsSync(p))

  return {markdownPaths, searchPaths}
}

/**
 * Scan the environment for available memory providers.
 *
 * Detects:
 * - Obsidian vaults (by scanning for `.obsidian/` directories)
 * - Local markdown folders (by checking explicit paths for .md files)
 * - Cloud providers (by checking environment variables)
 *
 * @param options - Search paths and env var overrides for testability
 * @returns Array of detected (and undetected) providers
 */
export async function detectProviders(
  options?: DetectProvidersOptions
): Promise<DetectedProvider[]> {
  // const env = options?.env ?? process.env  // Re-enable for honcho/hindsight detection in Phase 3
  const defaults = options?.searchPaths ? undefined : getDefaultSearchPaths()
  const searchPaths = options?.searchPaths ?? defaults?.searchPaths ?? []
  const markdownPaths = options?.markdownPaths ?? defaults?.markdownPaths ?? []

  const providers: DetectedProvider[] = []

  // ByteRover is always present
  providers.push({
    detected: true,
    id: 'byterover',
    type: 'local',
  })

  // Scan for Obsidian vaults
  const obsidianVaults = findObsidianVaults(searchPaths)
  if (obsidianVaults.length > 0) {
    providers.push(...obsidianVaults)
  } else {
    providers.push({
      detected: false,
      id: 'obsidian',
      type: 'local',
    })
  }

  // Check explicit markdown folders
  const mdFolders = findMarkdownFolders(markdownPaths)
  if (mdFolders.length > 0) {
    providers.push(...mdFolders)
  }

  // Always include an undetected local-markdown entry so the user can manually add folders
  // Cloud providers — check env vars
  providers.push({
    detected: false,
    id: 'local-markdown',
    type: 'local',
  })

  // Honcho and Hindsight temporarily disabled — adapters coming in Phase 3.

  // GBrain — detect local CLI checkout by checking common locations for src/cli.ts
  // (This path is the tool source tree, not `providers.gbrain.repoPath` / brain data.)
  const gbrainCandidates =
    options?.gbrainCandidatePaths === undefined
      ? [
          join(process.cwd(), '..', 'gbrain'),
          join(homedir(), 'gbrain'),
          join(homedir(), 'Myspace', 'campfire', 'workspace', 'gbrain'),
        ]
      : options.gbrainCandidatePaths
  const gbrainPath = gbrainCandidates.find((p) => existsSync(join(p, 'src', 'cli.ts')))
  providers.push({
    detected: Boolean(gbrainPath),
    id: 'gbrain',
    path: gbrainPath,
    type: 'cloud',
  })

  return providers
}
