import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Normalize file path - handles relative, absolute, tilde, symlinks
 * Returns absolute canonical path
 * @param filePath - The file path to normalize
 * @returns Normalized absolute path
 */
function normalizeFilePath(filePath: string, baseDir?: string): string {
  // Expand tilde to home directory
  const expanded = filePath.startsWith('~') ? filePath.replace(/^~/, os.homedir()) : filePath

  // Resolve to absolute path using baseDir for relative paths
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(baseDir ?? process.cwd(), expanded)

  // Resolve symlinks (only if file exists)
  try {
    return fs.realpathSync(absolute)
  } catch {
    // File doesn't exist or cannot resolve, return resolved path
    return absolute
  }
}

/**
 * Check if file is text (no null bytes in first 8KB)
 * Returns false for binary files (images, PDFs, compiled binaries, etc.)
 * @param filePath - The file path to check
 * @returns true if file is text, false if binary
 */
function isTextFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(8192)
    const fd = fs.openSync(filePath, 'r')
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0)
    fs.closeSync(fd)

    // Check for null bytes (indicates binary file)
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return false
    }

    return true
  } catch {
    // If we can't read the file, consider it non-text
    return false
  }
}

/**
 * Validate file for --files flag in brv curate command
 * Checks:
 * 1. File exists
 * 2. File is within project directory (where .brv exists)
 * 3. File is text/code file (not binary)
 *
 * @param filePath - The file path to validate (can be relative, absolute, or tilde)
 * @param projectRoot - The project root directory (current working directory)
 * @returns Validation result with normalized path or error message
 */
export function validateFileForCurate(
  filePath: string,
  projectRoot: string,
): {
  error?: string
  normalizedPath?: string
  valid: boolean
} {
  // Normalize path using projectRoot as base for relative paths
  const normalized = normalizeFilePath(filePath, projectRoot)

  // Check existence
  if (!fs.existsSync(normalized)) {
    return {error: `File does not exist: ${filePath}`, valid: false}
  }

  // Check if it's a file (not a directory)
  const stats = fs.statSync(normalized)
  if (!stats.isFile()) {
    return {error: `Path is not a file: ${filePath}`, valid: false}
  }

  // Check within project (normalized paths for reliable comparison)
  const normalizedProjectRoot = normalizeFilePath(projectRoot)
  if (!normalized.startsWith(normalizedProjectRoot + path.sep) && normalized !== normalizedProjectRoot) {
    return {error: `File is outside project directory: ${filePath}`, valid: false}
  }

  // Check is text file
  if (!isTextFile(normalized)) {
    return {error: `File is not a text/code file (binary detected): ${filePath}`, valid: false}
  }

  return {normalizedPath: normalized, valid: true}
}
