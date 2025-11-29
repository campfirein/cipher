import {readdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'

/**
 * Finds the most recent file in a directory by modification time.
 * @param directory - Absolute path to directory to search
 * @returns Absolute path to the most recent file
 * @throws Error if directory is empty or doesn't exist
 */
export async function findLatestFile(directory: string): Promise<string> {
  const files = await readdir(directory, {withFileTypes: true})
  const fileNames = files.filter((f) => f.isFile()).map((f) => f.name)

  if (fileNames.length === 0) {
    throw new Error(`No files found in directory: ${directory}`)
  }

  // Sort files by name (timestamp-based naming ensures latest is last)
  // Assuming filenames follow pattern: prefix-{timestamp}.json
  fileNames.sort()
  const latestFile = fileNames.at(-1)!

  return join(directory, latestFile)
}

/**
 * Removes all files from a directory while preserving the directory itself.
 * Returns the number of files removed.
 * Silently succeeds if directory doesn't exist.
 * @param dirPath - Absolute path to directory to clear
 * @returns Number of files removed
 */
export async function clearDirectory(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true})

    // Filter to only get files (not subdirectories)
    const files = entries.filter((entry) => entry.isFile())

    // Remove each file
    await Promise.all(
      files.map((file) => unlink(join(dirPath, file.name))),
    )

    return files.length
  } catch (error) {
    // If directory doesn't exist (ENOENT), return 0
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }

    // Re-throw other errors
    throw error
  }
}

/**
 * Sanitizes a folder path by replacing all special characters with a hyphen.
 * @param folderName - The folder path need to santiize
 * @returns The sanitized folder path
 */
export function sanitizeFolderName(folderName: string): string {
  return folderName.replaceAll(/[^\w\-./]/g, '-');
}