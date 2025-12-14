import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Environment context information for system prompts.
 * Provides the Cipher agent with awareness of its operating environment.
 */
export interface EnvironmentContext {
  /** Formatted .brv directory structure explanation */
  brvStructure: string
  /** Formatted project file tree */
  fileTree: string
  /** Whether the working directory is a git repository */
  isGitRepository: boolean
  /** Node.js version */
  nodeVersion: string
  /** Operating system version */
  osVersion: string
  /** Operating system platform (darwin, linux, win32) */
  platform: string
  /** Absolute path to the working directory */
  workingDirectory: string
}

/**
 * Options for building environment context.
 */
export interface EnvironmentContextOptions {
  /** Whether to include .brv structure explanation (default: true) */
  includeBrvStructure?: boolean
  /** Whether to include file tree (default: true) */
  includeFileTree?: boolean
  /** Maximum depth for file tree traversal (default: 3) */
  maxFileTreeDepth?: number
  /** Maximum number of entries in file tree (default: 100) */
  maxFileTreeEntries?: number
  /** Working directory path */
  workingDirectory: string
}

/**
 * Options for directory traversal.
 */
interface TraverseOptions {
  /** Current traversal depth */
  currentDepth: number
  /** Current directory path */
  dir: string
  /** Counter for entries added (mutable object) */
  entriesCount: {value: number}
  /** Array to append lines to */
  lines: string[]
  /** Maximum depth to traverse */
  maxDepth: number
  /** Maximum entries to include */
  maxEntries: number
  /** Counter for truncated entries (mutable object) */
  truncatedCount: {value: number}
}

/**
 * Patterns to exclude from file tree.
 */
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.brv',
  'dist',
  'build',
  '.next',
  'coverage',
  '.DS_Store',
  '.env',
  '.env.local',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '*.log',
  '.turbo',
  '.cache',
]

/**
 * Builds environment context for system prompts.
 *
 * Gathers information about:
 * - Working directory
 * - Git repository status
 * - Platform and OS version
 * - Project file tree
 * - .brv directory structure
 */
export class EnvironmentContextBuilder {
  /**
   * Build the complete environment context.
   *
   * @param options - Configuration options
   * @returns Environment context object
   */
  public async build(options: EnvironmentContextOptions): Promise<EnvironmentContext> {
    const {
      includeBrvStructure = true,
      includeFileTree = true,
      maxFileTreeDepth = 3,
      maxFileTreeEntries = 100,
      workingDirectory,
    } = options

    const isGitRepository = this.detectGitRepository(workingDirectory)

    let fileTree = ''
    if (includeFileTree) {
      fileTree = this.buildFileTree(workingDirectory, maxFileTreeDepth, maxFileTreeEntries)
    }

    let brvStructure = ''
    if (includeBrvStructure) {
      brvStructure = this.buildBrvStructure(workingDirectory)
    }

    return {
      brvStructure,
      fileTree,
      isGitRepository,
      nodeVersion: process.version,
      osVersion: os.release(),
      platform: os.platform(),
      workingDirectory,
    }
  }

  /**
   * Build an explanation of the .brv directory structure.
   *
   * @param dir - Working directory path
   * @returns Formatted .brv structure explanation
   */
  private buildBrvStructure(dir: string): string {
    const brvDir = path.join(dir, '.brv')

    if (!fs.existsSync(brvDir)) {
      return '<brv-structure>\nByteRover not initialized (.brv directory not found)\n</brv-structure>'
    }

    // Build actual structure by reading the directory
    const structure: string[] = ['<brv-structure>', '.brv/']

    try {
      const entries = fs.readdirSync(brvDir, {withFileTypes: true})

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const description = this.getBrvDirectoryDescription(entry.name)
          structure.push(`  ${entry.name}/          ${description}`)
        } else {
          const description = this.getBrvFileDescription(entry.name)
          structure.push(`  ${entry.name}          ${description}`)
        }
      }
    } catch {
      structure.push('  (unable to read directory contents)')
    }

    structure.push('</brv-structure>')
    return structure.join('\n')
  }

  /**
   * Build a formatted file tree of the project.
   *
   * @param dir - Root directory to start from
   * @param maxDepth - Maximum traversal depth
   * @param maxEntries - Maximum number of entries to include
   * @returns Formatted file tree string
   */
  private buildFileTree(dir: string, maxDepth: number, maxEntries: number): string {
    const entriesCount = {value: 0}
    const truncatedCount = {value: 0}
    const lines: string[] = ['<files>']

    this.traverseDirectory({
      currentDepth: 0,
      dir,
      entriesCount,
      lines,
      maxDepth,
      maxEntries,
      truncatedCount,
    })

    if (truncatedCount.value > 0) {
      lines.push(`[${truncatedCount.value} entries truncated]`)
    }

    lines.push('</files>')
    return lines.join('\n')
  }

  /**
   * Check if a directory is a git repository.
   *
   * @param dir - Directory path to check
   * @returns True if the directory contains a .git folder
   */
  private detectGitRepository(dir: string): boolean {
    try {
      const gitDir = path.join(dir, '.git')
      return fs.existsSync(gitDir)
    } catch {
      return false
    }
  }

  /**
   * Get description for a .brv directory.
   *
   * @param name - Directory name
   * @returns Description string
   */
  private getBrvDirectoryDescription(name: string): string {
    const descriptions: Record<string, string> = {
      blobs: '# Storage for conversation history',
      'context-tree': '# Semantic knowledge organized by domain',
      logs: '# Debug logs for troubleshooting',
    }
    return descriptions[name] ?? ''
  }

  /**
   * Get description for a .brv file.
   *
   * @param name - File name
   * @returns Description string
   */
  private getBrvFileDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'config.json': '# Project configuration',
    }
    return descriptions[name] ?? ''
  }

  /**
   * Check if a file or directory should be excluded from the tree.
   *
   * @param name - File or directory name
   * @returns True if should be excluded
   */
  private shouldExclude(name: string): boolean {
    for (const pattern of EXCLUDE_PATTERNS) {
      if (pattern.startsWith('*')) {
        // Wildcard pattern (e.g., *.log)
        const extension = pattern.slice(1)
        if (name.endsWith(extension)) {
          return true
        }
      } else if (name === pattern) {
        return true
      }
    }

    return false
  }

  /**
   * Recursively traverse a directory and build tree lines.
   *
   * @param options - Traversal options
   * @param options.dir - Current directory path
   * @param options.maxDepth - Maximum depth to traverse
   * @param options.maxEntries - Maximum entries to include
   * @param options.currentDepth - Current traversal depth
   * @param options.entriesCount - Counter for entries added (mutable object with value property)
   * @param options.truncatedCount - Counter for truncated entries (mutable object with value property)
   * @param options.lines - Array to append lines to
   */
  private traverseDirectory(options: TraverseOptions): void {
    const {currentDepth, dir, entriesCount, lines, maxDepth, maxEntries, truncatedCount} = options
    if (currentDepth >= maxDepth) {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    // Filter and sort: directories first, then alphabetically
    const filteredEntries = entries
      .filter((entry) => !this.shouldExclude(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

    const indent = '  '.repeat(currentDepth)

    for (const entry of filteredEntries) {
      if (entriesCount.value >= maxEntries) {
        truncatedCount.value += filteredEntries.length - filteredEntries.indexOf(entry)
        break
      }

      entriesCount.value++

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`)
        this.traverseDirectory({
          currentDepth: currentDepth + 1,
          dir: path.join(dir, entry.name),
          entriesCount,
          lines,
          maxDepth,
          maxEntries,
          truncatedCount,
        })
      } else {
        lines.push(`${indent}${entry.name}`)
      }
    }
  }
}
