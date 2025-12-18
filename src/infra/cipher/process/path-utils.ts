/**
 * Path utilities for cross-platform compatibility.
 *
 * Provides functions for normalizing paths across different environments,
 * particularly handling Git Bash and MSYS/Cygwin Unix-style paths on Windows.
 */

/**
 * Normalize paths for cross-platform compatibility.
 * Handles Git Bash Unix-style paths on Windows (e.g., /c/Users/... -> C:\Users\...)
 *
 * @param inputPath - Path to normalize
 * @returns Normalized path for the current platform
 *
 * @example
 * // On Windows with Git Bash path
 * normalizePath('/c/Users/name') // Returns 'C:\\Users\\name'
 *
 * @example
 * // On Unix, returns unchanged
 * normalizePath('/home/user') // Returns '/home/user'
 */
export function normalizePath(inputPath: string): string {
  if (process.platform !== 'win32') {
    return inputPath
  }

  // Git Bash on Windows returns Unix-style paths like /c/Users/...
  if (/^\/[a-z]\//i.test(inputPath)) {
    return inputPath
      .replace(/^\/([a-z])\//i, (_, drive: string) => `${drive.toUpperCase()}:\\`)
      .replaceAll('/', '\\')
  }

  // MSYS/Cygwin style: /cygdrive/c/...
  if (/^\/cygdrive\/[a-z]\//i.test(inputPath)) {
    return inputPath
      .replace(/^\/cygdrive\/([a-z])\//i, (_, drive: string) => `${drive.toUpperCase()}:\\`)
      .replaceAll('/', '\\')
  }

  return inputPath
}

/**
 * Check if a path is a Windows absolute path.
 *
 * @param inputPath - Path to check
 * @returns True if the path is a Windows absolute path (e.g., C:\ or C:/)
 *
 * @example
 * isWindowsAbsolute('C:\\Users') // Returns true
 * isWindowsAbsolute('C:/Users')  // Returns true
 * isWindowsAbsolute('/home/user') // Returns false
 */
export function isWindowsAbsolute(inputPath: string): boolean {
  return /^[a-z]:\\/i.test(inputPath) || /^[a-z]:\//i.test(inputPath)
}

/**
 * Normalize path for comparison (lowercase drive letter, forward slashes).
 * Useful when comparing paths that may have different separator styles.
 *
 * @param inputPath - Path to normalize for comparison
 * @returns Normalized path with lowercase drive and forward slashes (Windows only)
 *
 * @example
 * // On Windows
 * normalizeForComparison('C:\\Users\\Name') // Returns 'c:/Users/Name'
 *
 * @example
 * // On Unix, returns unchanged
 * normalizeForComparison('/home/user') // Returns '/home/user'
 */
export function normalizeForComparison(inputPath: string): string {
  if (process.platform !== 'win32') {
    return inputPath
  }

  return inputPath
    .replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
    .replaceAll('\\', '/')
}

/**
 * Check if a path appears to be a Git Bash or MSYS/Cygwin Unix-style path on Windows.
 *
 * @param inputPath - Path to check
 * @returns True if the path looks like a Unix-style path that needs normalization on Windows
 *
 * @example
 * isUnixStyleWindowsPath('/c/Users') // Returns true
 * isUnixStyleWindowsPath('/cygdrive/c/Users') // Returns true
 * isUnixStyleWindowsPath('/home/user') // Returns false (no drive letter pattern)
 */
export function isUnixStyleWindowsPath(inputPath: string): boolean {
  return /^\/[a-z]\//i.test(inputPath) || /^\/cygdrive\/[a-z]\//i.test(inputPath)
}
