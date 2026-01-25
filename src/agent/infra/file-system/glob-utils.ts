import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * File metadata for sorting purposes.
 */
export interface FileMetadata {
  modifiedTime: Date
  path: string
  size: number
}

/**
 * Default recency threshold: 24 hours in milliseconds.
 * Files modified within this period are considered "recent".
 */
export const RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * Collects metadata for a list of file paths.
 *
 * @param filePaths - Array of file paths to collect metadata for
 * @param basePath - Base path for resolving relative paths
 * @returns Promise resolving to array of FileMetadata objects
 */
export async function collectFileMetadata(filePaths: string[], basePath: string): Promise<FileMetadata[]> {
  const results: FileMetadata[] = []

  for (const filePath of filePaths) {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(basePath, filePath)
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(fullPath)
      results.push({
        modifiedTime: stats.mtime,
        path: filePath,
        size: stats.size,
      })
    } catch {
      // If we can't stat the file, include it with default metadata
      results.push({
        modifiedTime: new Date(0),
        path: filePath,
        size: 0,
      })
    }
  }

  return results
}

/**
 * Sorts files by recency with smart ordering:
 * - Files modified within the recency threshold come first (newest to oldest)
 * - Older files are sorted alphabetically
 *
 * This approach prioritizes recently modified files for developer convenience
 * while maintaining predictable ordering for older files.
 *
 * @param files - Array of FileMetadata to sort
 * @param recencyThresholdMs - Threshold in ms for considering a file "recent" (default: 24 hours)
 * @returns Sorted array of FileMetadata
 */
export function sortFilesByRecency(
  files: FileMetadata[],
  recencyThresholdMs: number = RECENCY_THRESHOLD_MS,
): FileMetadata[] {
  const now = Date.now()
  const threshold = now - recencyThresholdMs

  // Partition files into recent and old
  const recentFiles: FileMetadata[] = []
  const oldFiles: FileMetadata[] = []

  for (const file of files) {
    if (file.modifiedTime.getTime() >= threshold) {
      recentFiles.push(file)
    } else {
      oldFiles.push(file)
    }
  }

  // Sort recent files by modification time (newest first)
  recentFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())

  // Sort old files alphabetically by path
  oldFiles.sort((a, b) => a.path.localeCompare(b.path))

  return [...recentFiles, ...oldFiles]
}

/**
 * Glob special characters that need escaping.
 */
const GLOB_SPECIAL_CHARS = /[*?[\]{}()!@#]/

/**
 * Escapes a pattern if it matches an actual file/directory.
 *
 * This handles edge cases where file/directory names contain glob special characters
 * (e.g., `[test]`, `(dashboard)`, `file?.txt`). If the pattern exactly matches
 * an existing path, we escape it to prevent glob interpretation.
 *
 * @param pattern - The glob pattern to potentially escape
 * @param cwd - Current working directory for checking file existence
 * @returns The pattern, escaped if it matches an existing file
 */
export async function escapeIfExactMatch(pattern: string, cwd: string): Promise<string> {
  // If pattern doesn't contain special characters, no escaping needed
  if (!GLOB_SPECIAL_CHARS.test(pattern)) {
    return pattern
  }

  // Check if the pattern exactly matches a file or directory
  const fullPath = path.isAbsolute(pattern) ? pattern : path.join(cwd, pattern)

  try {
    await fs.access(fullPath)
    // File/directory exists, escape special characters
    return escapeGlobCharacters(pattern)
  } catch {
    // File doesn't exist, treat as glob pattern
    return pattern
  }
}

/**
 * Escapes glob special characters in a string.
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in glob patterns
 */
export function escapeGlobCharacters(str: string): string {
  return str.replaceAll(/([*?[\]{}()!@#])/g, String.raw`\$1`)
}

/**
 * Extracts paths from FileMetadata array.
 *
 * @param files - Array of FileMetadata
 * @returns Array of file paths
 */
export function extractPaths(files: FileMetadata[]): string[] {
  return files.map((f) => f.path)
}
