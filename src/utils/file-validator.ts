import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {isBinaryFile, isMediaFile} from '../agent/file-system/binary-utils.js'

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
 * Validate file for --files flag in brv curate command
 * Checks:
 * 1. File exists
 * 2. File is within project directory (where .brv exists)
 * 3. File is supported by read_file tool (text, images, or PDFs)
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
  // Normalize projectRoot first to ensure consistent behavior
  // This handles cases where projectRoot might be relative
  const normalizedProjectRoot = normalizeFilePath(projectRoot)

  // Normalize file path using normalizedProjectRoot as base for relative paths
  const normalized = normalizeFilePath(filePath, normalizedProjectRoot)

  // Check existence
  if (!fs.existsSync(normalized)) {
    return { error: `File does not exist: ${filePath}`, valid: false }
  }

  // Check if it's a file (not a directory)
  const stats = fs.statSync(normalized)
  if (!stats.isFile()) {
    return { error: `Path is not a file: ${filePath}`, valid: false }
  }

  // Check within project (both paths are already normalized)
  if (!normalized.startsWith(normalizedProjectRoot + path.sep) && normalized !== normalizedProjectRoot) {
    return { error: `File is outside project directory: ${filePath}`, valid: false }
  }

  // Read sample buffer for file type detection
  let buffer: Buffer
  let bytesRead: number
  try {
    buffer = Buffer.alloc(4096)
    const fd = fs.openSync(normalized, 'r')
    bytesRead = fs.readSync(fd, buffer, 0, 4096, 0)
    fs.closeSync(fd)
  } catch {
    return { error: `Cannot read file: ${filePath}`, valid: false }
  }

  const sampleBuffer = buffer.subarray(0, bytesRead)

  // Check file type using binary-utils (same logic as read_file tool)
  // Allow media files (images/PDFs) - read_file can handle these
  // For PDFs, also validate magic bytes to reject fake PDFs (e.g., binary.pdf)
  if (isMediaFile(normalized, sampleBuffer)) {
    return { normalizedPath: normalized, valid: true }
  }

  // Check if it's a binary file (using same logic as read_file tool)
  if (isBinaryFile(normalized, sampleBuffer)) {
    return { error: `File type not supported: ${filePath}`, valid: false }
  }

  // It's a text file - supported
  return { normalizedPath: normalized, valid: true }
}
