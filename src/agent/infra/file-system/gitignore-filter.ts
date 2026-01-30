import ignore, {type Ignore} from 'ignore'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Result of filtering paths through gitignore rules.
 */
export interface FilterResult {
  /** Paths that passed the filter (not ignored) */
  filtered: string[]
  /** Number of paths that were ignored */
  ignoredCount: number
}

/**
 * GitignoreFilter handles .gitignore-based file filtering.
 *
 * It reads .gitignore files from the project root and applies
 * the ignore rules to filter out paths that should be excluded.
 *
 * Usage:
 * ```typescript
 * const filter = new GitignoreFilter('/path/to/project')
 * await filter.initialize()
 * const result = filter.filterPaths(['src/index.ts', 'node_modules/pkg/index.js'])
 * // result.filtered = ['src/index.ts']
 * // result.ignoredCount = 1
 * ```
 */
export class GitignoreFilter {
  private ig: Ignore
  private initialized = false
  private readonly rootPath: string

  /**
   * Creates a new GitignoreFilter instance.
   *
   * @param rootPath - Root path of the project to search for .gitignore files
   */
  constructor(rootPath: string) {
    this.rootPath = rootPath
    this.ig = ignore()
  }

  /**
   * Filters an array of paths, removing those that match gitignore rules.
   *
   * @param relativePaths - Array of paths relative to the root to filter
   * @returns FilterResult with filtered paths and ignored count
   * @throws Error if filter not initialized
   */
  filterPaths(relativePaths: string[]): FilterResult {
    if (!this.initialized) {
      throw new Error('GitignoreFilter not initialized. Call initialize() first.')
    }

    const filtered: string[] = []
    let ignoredCount = 0

    for (const relativePath of relativePaths) {
      // Normalize path separators
      const normalizedPath = relativePath.split(path.sep).join('/')

      if (this.ig.ignores(normalizedPath)) {
        ignoredCount++
      } else {
        filtered.push(relativePath)
      }
    }

    return {filtered, ignoredCount}
  }

  /**
   * Initializes the filter by reading .gitignore files.
   * Must be called before using filterPaths or isIgnored.
   *
   * Reads:
   * - .gitignore from the root path
   * - Optionally could be extended to read nested .gitignore files
   *
   * Always adds common ignore patterns:
   * - .git directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Always ignore .git directory
    this.ig.add('.git')

    // Try to read .gitignore from root
    const gitignorePath = path.join(this.rootPath, '.gitignore')

    try {
      const content = await fs.readFile(gitignorePath, 'utf8')
      this.ig.add(content)
    } catch {
      // .gitignore doesn't exist or can't be read, continue without it
    }

    this.initialized = true
  }

  /**
   * Checks if a single path is ignored by gitignore rules.
   *
   * @param relativePath - Path relative to the root to check
   * @returns true if the path should be ignored
   * @throws Error if filter not initialized
   */
  isIgnored(relativePath: string): boolean {
    if (!this.initialized) {
      throw new Error('GitignoreFilter not initialized. Call initialize() first.')
    }

    // Normalize path separators for cross-platform compatibility
    const normalizedPath = relativePath.split(path.sep).join('/')

    return this.ig.ignores(normalizedPath)
  }

  /**
   * Checks if the filter has been initialized.
   *
   * @returns true if initialize() has been called
   */
  isInitialized(): boolean {
    return this.initialized
  }
}

/**
 * Creates and initializes a GitignoreFilter for the given path.
 * Convenience function that combines construction and initialization.
 *
 * @param rootPath - Root path of the project
 * @returns Initialized GitignoreFilter instance
 */
export async function createGitignoreFilter(rootPath: string): Promise<GitignoreFilter> {
  const filter = new GitignoreFilter(rootPath)
  await filter.initialize()
  return filter
}
