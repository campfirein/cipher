import { realpathSync } from 'node:fs'
import path from 'node:path'

import type { FileSystemConfig, ValidationResult } from '../../core/domain/file-system/types.js'

import { getErrorMessage } from '../../../server/utils/error-helpers.js'

/**
 * Validates file paths against security policies.
 * Implements defense-in-depth with multiple layers of validation:
 * 1. Empty path check
 * 2. Path normalization
 * 3. Path traversal detection
 * 4. Allowed paths whitelist
 * 5. Blocked paths blacklist
 * 6. File extension validation
 */
export class PathValidator {
  private readonly blockedExtensions: Set<string>
  private readonly normalizedAllowedPaths: string[]
  private readonly normalizedBlockedPaths: string[]
  private readonly workingDirectory: string

  /**
   * Creates a new path validator
   * @param config - File system configuration
   */
  public constructor(config: FileSystemConfig) {
    // Resolve working directory, trying to resolve symlinks for consistency
    const resolvedWorkingDir = path.resolve(config.workingDirectory)
    try {
      this.workingDirectory = realpathSync.native(resolvedWorkingDir)
    } catch {
      this.workingDirectory = resolvedWorkingDir
    }

    this.blockedExtensions = new Set(config.blockedExtensions.map((ext) => ext.toLowerCase()))

    // Normalize and resolve all allowed paths to absolute paths
    // Also try to resolve symlinks for consistent comparison with realpathSync results
    this.normalizedAllowedPaths = config.allowedPaths.map((allowedPath) => {
      const resolved = path.resolve(this.workingDirectory, allowedPath)
      try {
        // Try to get the real path (resolving symlinks like /var -> /private/var on macOS)
        return realpathSync.native(resolved)
      } catch {
        // Path might not exist yet, use resolved path as-is
        return resolved
      }
    })

    // Normalize blocked paths
    this.normalizedBlockedPaths = config.blockedPaths.map((blockedPath) =>
      path.isAbsolute(blockedPath) ? path.normalize(blockedPath) : blockedPath,
    )
  }

  /**
   * Validates a file path against all security policies.
   *
   * @param filePath - Path to validate
   * @param operation - Operation type ('read' or 'write')
   * @returns Validation result with normalized path or error message
   */
  public validate(filePath: string, operation: 'read' | 'write'): ValidationResult {
    // 1. Check for empty path
    if (!filePath || filePath.trim().length === 0) {
      return {
        error: 'Path cannot be empty',
        valid: false,
      }
    }

    // 2. Normalize and resolve the path
    let normalizedPath: string
    try {
      normalizedPath = this.normalizeAndResolve(filePath)
    } catch (error) {
      return {
        error: `Failed to resolve path: ${getErrorMessage(error)}`,
        valid: false,
      }
    }

    // 3. Check for path traversal
    if (this.isPathTraversal(filePath, normalizedPath)) {
      return {
        error: 'Path traversal detected',
        valid: false,
      }
    }

    // 4. Check if path is in allowed paths
    if (!this.isPathAllowed(normalizedPath)) {
      return {
        error: `Path not in allowed paths. Allowed: ${this.normalizedAllowedPaths.join(', ')}`,
        valid: false,
      }
    }

    // 5. Check if path is blocked
    const blockReason = this.isPathBlocked(normalizedPath)
    if (blockReason) {
      return {
        error: blockReason,
        valid: false,
      }
    }

    // 6. Check file extension (only for write operations to prevent creating dangerous files)
    if (operation === 'write' && this.hasBlockedExtension(filePath)) {
      const ext = path.extname(filePath).toLowerCase()
      return {
        error: `File extension blocked: ${ext}`,
        valid: false,
      }
    }

    return {
      normalizedPath,
      valid: true,
    }
  }

  /**
   * Checks if a file has a blocked extension.
   *
   * @param filePath - File path to check
   * @returns True if extension is blocked
   */
  private hasBlockedExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return this.blockedExtensions.has(ext)
  }

  /**
   * Checks if a path is within the allowed paths.
   *
   * @param normalizedPath - Normalized absolute path
   * @returns True if path is allowed
   */
  private isPathAllowed(normalizedPath: string): boolean {
    return this.normalizedAllowedPaths.some((allowedPath) => {
      const relative = path.relative(allowedPath, normalizedPath)
      // Path is allowed if it's within the allowed path (doesn't start with ..)
      return !relative.startsWith('..') && !path.isAbsolute(relative)
    })
  }

  /**
   * Checks if a path matches any blocked path patterns.
   * Supports both absolute and relative blocked paths.
   *
   * @param normalizedPath - Normalized absolute path
   * @returns Error message if blocked, false if not blocked
   */
  private isPathBlocked(normalizedPath: string): false | string {
    // Check against all allowed path roots
    for (const allowedRoot of this.normalizedAllowedPaths) {
      for (const blocked of this.normalizedBlockedPaths) {
        // If blocked path is absolute, check directly
        if (path.isAbsolute(blocked)) {
          const blockedFull = path.normalize(blocked)
          if (normalizedPath === blockedFull || normalizedPath.startsWith(blockedFull + path.sep)) {
            return `Within blocked directory: ${blocked}`
          }
        } else {
          // If blocked path is relative, check against all allowed roots
          const blockedFull = path.resolve(allowedRoot, blocked)
          if (normalizedPath === blockedFull || normalizedPath.startsWith(blockedFull + path.sep)) {
            return `Within blocked directory: ${blocked}`
          }
        }
      }
    }

    return false
  }

  /**
   * Checks if a path contains path traversal attempts.
   * Detects both explicit traversal sequences and resolved paths outside working directory.
   *
   * @param originalPath - Original path provided by user
   * @param normalizedPath - Normalized absolute path
   * @returns True if path traversal detected
   */
  private isPathTraversal(originalPath: string, normalizedPath: string): boolean {
    // Check for explicit traversal sequences
    if (originalPath.includes('../') || originalPath.includes('..\\')) {
      // Verify that the resolved path doesn't escape working directory
      const relative = path.relative(this.workingDirectory, normalizedPath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return true
      }
    }

    return false
  }

  /**
   * Normalizes and resolves a file path to an absolute path.
   * Uses realpath to resolve symlinks if the path exists.
   *
   * Handles path duplication prevention:
   * - If the working directory ends with a path segment that matches the start
   *   of the relative file path, the resolution is adjusted to prevent duplication.
   * - Example: workingDir = "/project/.brv/context-tree", filePath = ".brv/context-tree/domain/file.md"
   *   Without fix: "/project/.brv/context-tree/.brv/context-tree/domain/file.md" (WRONG)
   *   With fix: "/project/.brv/context-tree/domain/file.md" (CORRECT)
   *
   * @param filePath - Path to normalize
   * @returns Normalized absolute path
   */
  private normalizeAndResolve(filePath: string): string {
    // If the path is already absolute, just normalize it.
    // For relative paths, check for potential path duplication.
    // This can happen when:
    // 1. workingDirectory ends with a subdirectory like ".brv/context-tree"
    // 2. filePath starts with the same subdirectory ".brv/context-tree/..."
    // In this case, we should resolve from the parent to avoid duplication.
    let normalizedPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : this.resolveWithoutDuplication(filePath)

    // Try to resolve symlinks if path exists
    try {
      // Use native variant to preserve casing on Windows
      normalizedPath = realpathSync.native(normalizedPath)
    } catch {
      // Path doesn't exist yet (e.g., for writes)
      // Try to resolve the parent directory's real path for consistency
      normalizedPath = this.resolveParentRealPath(normalizedPath)
    }

    return normalizedPath
  }

  /**
   * For non-existent files, try to resolve the parent directory's real path
   * and append the filename. This ensures consistency with existing paths
   * when symlinks are involved (e.g., /var -> /private/var on macOS).
   *
   * @param filePath - Absolute path to a potentially non-existent file
   * @returns Path with parent directory symlinks resolved
   */
  private resolveParentRealPath(filePath: string): string {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)

    try {
      // Try to resolve the parent directory
      const realDir = realpathSync.native(dir)
      return path.join(realDir, base)
    } catch {
      // Parent doesn't exist either, try grandparent
      const grandparentDir = path.dirname(dir)
      const parentBase = path.basename(dir)

      try {
        const realGrandparent = realpathSync.native(grandparentDir)
        return path.join(realGrandparent, parentBase, base)
      } catch {
        // Give up and return normalized path
        return path.normalize(filePath)
      }
    }
  }

  /**
   * Resolves a relative path against the working directory while preventing
   * path segment duplication.
   *
   * @param filePath - Relative path to resolve
   * @returns Resolved absolute path
   */
  private resolveWithoutDuplication(filePath: string): string {
    // Normalize the file path to handle different separators
    const normalizedFilePath = path.normalize(filePath)

    // Split both paths into segments for comparison
    const workingDirSegments = this.workingDirectory.split(path.sep).filter(Boolean)
    const filePathSegments = normalizedFilePath.split(path.sep).filter(Boolean)

    // Try to find a matching suffix of workingDirectory that matches
    // the prefix of filePath to detect potential duplication
    for (let suffixLen = Math.min(workingDirSegments.length, filePathSegments.length); suffixLen > 0; suffixLen--) {
      const workingDirSuffix = workingDirSegments.slice(-suffixLen)
      const filePathPrefix = filePathSegments.slice(0, suffixLen)

      // Check if the suffix of working dir matches the prefix of file path
      if (this.segmentsMatch(workingDirSuffix, filePathPrefix)) {
        // Found a match! Remove the duplicate prefix from file path
        // and resolve from working directory
        const remainingSegments = filePathSegments.slice(suffixLen)
        return path.join(this.workingDirectory, ...remainingSegments)
      }
    }

    // No duplication detected, resolve normally
    return path.resolve(this.workingDirectory, filePath)
  }

  /**
   * Checks if two arrays of path segments match.
   *
   * @param segments1 - First array of path segments
   * @param segments2 - Second array of path segments
   * @returns True if all segments match
   */
  private segmentsMatch(segments1: string[], segments2: string[]): boolean {
    if (segments1.length !== segments2.length) {
      return false
    }

    return segments1.every((seg, i) => seg === segments2[i])
  }
}
