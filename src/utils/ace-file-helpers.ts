import {readdir, readFile} from 'node:fs/promises'
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
