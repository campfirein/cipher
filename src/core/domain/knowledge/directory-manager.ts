import * as fs from 'node:fs/promises'
import {dirname, join} from 'node:path'

/**
 * Result of ensuring knowledge structure exists.
 */
export interface EnsureStructureResult {
  contextTreeExisted: boolean
  indexExisted: boolean
}

/**
 * Result of creating or updating a domain/topic.
 */
export interface CreateOrUpdateResult {
  created: boolean
  skipped: boolean
  updated: boolean
}

/**
 * Manages directory and file operations for knowledge structure.
 * Handles existing directories and files without recreating them.
 */
export const DirectoryManager = {
  /**
   * Create or update a domain folder.
   * If domain exists, returns indication to update; if new, creates folder.
   *
   * @param domainPath - Full path to domain folder
   * @returns Whether domain was created, updated, or skipped
   */
  async createOrUpdateDomain(domainPath: string): Promise<CreateOrUpdateResult> {
    try {
      await fs.access(domainPath)
      // Domain exists
      return {created: false, skipped: false, updated: true}
    } catch {
      // Domain doesn't exist, create it
      await fs.mkdir(domainPath, {recursive: true})
      return {created: true, skipped: false, updated: false}
    }
  },

  /**
   * Create or update a topic folder.
   * If topic exists, returns indication to update; if new, creates folder.
   *
   * @param topicPath - Full path to topic folder
   * @returns Whether topic was created, updated, or skipped
   */
  async createOrUpdateTopic(topicPath: string): Promise<CreateOrUpdateResult> {
    try {
      await fs.access(topicPath)
      // Topic exists
      return {created: false, skipped: false, updated: true}
    } catch {
      // Topic doesn't exist, create it
      await fs.mkdir(topicPath, {recursive: true})
      return {created: true, skipped: false, updated: false}
    }
  },

  /**
   * Ensure the base knowledge structure exists.
   * Creates .brv/context-tree/ and index.json only if they don't exist.
   *
   * @param basePath - Base path for knowledge storage (typically .brv/context-tree)
   * @returns Information about what existed and what was created
   */
  async ensureKnowledgeStructure(basePath: string): Promise<EnsureStructureResult> {
    // Check if .brv/context-tree/ exists
    let contextTreeExisted = false
    try {
      await fs.access(basePath)
      contextTreeExisted = true
    } catch {
      // Directory doesn't exist, create it
      await fs.mkdir(basePath, {recursive: true})
    }

    // Check if index.json exists
    const indexPath = join(basePath, 'index.json')
    let indexExisted = false
    try {
      await fs.access(indexPath)
      indexExisted = true
    } catch {
      // Index doesn't exist, create empty index
      const emptyIndex = {
        domainIndex: {},
        lastUpdated: new Date().toISOString(),
        nameIndex: {},
        paths: {},
        version: '1.0',
      }
      await fs.writeFile(indexPath, JSON.stringify(emptyIndex, null, 2))
    }

    return {
      contextTreeExisted,
      indexExisted,
    }
  },

  /**
   * Ensure parent directory exists for a file path.
   *
   * @param filePath - Path to file
   */
  async ensureParentDirectory(filePath: string): Promise<void> {
    const parentDir = dirname(filePath)
    await fs.mkdir(parentDir, {recursive: true})
  },

  /**
   * Check if a file exists.
   *
   * @param filePath - Path to file
   * @returns true if file exists, false otherwise
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  },

  /**
   * List all markdown files recursively in a directory.
   *
   * @param dirPath - Directory to scan
   * @returns Array of absolute paths to .md files
   */
  async listMarkdownFiles(dirPath: string): Promise<string[]> {
    const mdFiles: string[] = []

    const scanDirectory = async (currentPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentPath, {withFileTypes: true})
        const subdirectories: string[] = []

        for (const entry of entries) {
          const fullPath = join(currentPath, entry.name)

          if (entry.isDirectory()) {
            subdirectories.push(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            mdFiles.push(fullPath)
          }
        }

        // Process subdirectories recursively
        await Promise.all(subdirectories.map((subdir) => scanDirectory(subdir)))
      } catch {
        // Directory doesn't exist or not accessible, skip it
      }
    }

    await scanDirectory(dirPath)
    return mdFiles
  },

  /**
   * Read a file's content.
   *
   * @param filePath - Path to file
   * @returns File content as string
   */
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8')
  },

  /**
   * Write a file atomically (write to temp, then rename).
   * This ensures the file is never in a partially written state.
   *
   * @param filePath - Path to file
   * @param content - Content to write
   */
  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`
    await fs.writeFile(tempPath, content, 'utf8')
    await fs.rename(tempPath, filePath)
  },
}
