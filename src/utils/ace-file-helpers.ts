import {readdir, readFile, unlink} from 'node:fs/promises'
import {join} from 'node:path'

import {DeltaBatch, type DeltaBatchJson} from '../core/domain/entities/delta-batch.js'
import {ExecutorOutput, type ExecutorOutputJson} from '../core/domain/entities/executor-output.js'
import {ReflectorOutput, type ReflectorOutputJson} from '../core/domain/entities/reflector-output.js'

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
 * Loads and parses an executor output file.
 * @param filePath - Absolute path to executor output JSON file
 * @returns ExecutorOutput entity
 * @throws Error if file doesn't exist or JSON is invalid
 */
export async function loadExecutorOutput(filePath: string): Promise<ExecutorOutput> {
  const content = await readFile(filePath, 'utf8')
  const json = JSON.parse(content) as ExecutorOutputJson

  return new ExecutorOutput({
    bulletIds: json.bulletIds,
    finalAnswer: json.finalAnswer,
    hint: json.hint || '',
    reasoning: json.reasoning,
    toolUsage: json.toolUsage,
  })
}

/**
 * Loads and parses a reflection output file.
 * @param filePath - Absolute path to reflection output JSON file
 * @returns ReflectorOutput entity
 * @throws Error if file doesn't exist or JSON is invalid
 */
export async function loadReflectionOutput(filePath: string): Promise<ReflectorOutput> {
  const content = await readFile(filePath, 'utf8')
  const json = JSON.parse(content) as ReflectorOutputJson

  return ReflectorOutput.fromJson(json)
}

/**
 * Loads and parses a delta batch file.
 * @param filePath - Absolute path to delta batch JSON file
 * @returns DeltaBatch entity
 * @throws Error if file doesn't exist or JSON is invalid
 */
export async function loadDeltaBatch(filePath: string): Promise<DeltaBatch> {
  const content = await readFile(filePath, 'utf8')
  const json = JSON.parse(content) as DeltaBatchJson

  return DeltaBatch.fromJson(json)
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
 * Sanitize hint for use in filename.
 * Converts to lowercase, replaces spaces/underscores with hyphens,
 * removes all non-alphanumeric characters except hyphens.
 * @param hint - The hint string to sanitize
 * @returns Sanitized hint suitable for filename
 */
export function sanitizeHint(hint: string): string {
  return hint
    .toLowerCase()
    .replaceAll(/[\s_]+/g, '-')
    .replaceAll(/[^\da-z-]/g, '')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
}
