import {mkdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {ACE_DIR, BR_DIR} from '../../constants.js'
import {DeltaBatch, type DeltaBatchJson} from '../../core/domain/entities/delta-batch.js'
import {ExecutorOutput, type ExecutorOutputJson} from '../../core/domain/entities/executor-output.js'
import {ReflectorOutput, type ReflectorOutputJson} from '../../core/domain/entities/reflector-output.js'

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

/**
 * Generates a timestamped filename for ACE output files.
 * @param type - The file type prefix (e.g., 'delta', 'reflection', 'executor-output')
 * @param hint - Optional hint to include in filename
 * @returns Filename in format: {type}-{hint}-{timestamp}.json or {type}-{timestamp}.json
 */
export function generateTimestampedFilename(type: string, hint?: string): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const sanitizedHint = hint ? sanitizeHint(hint) : ''

  return sanitizedHint ? `${type}-${sanitizedHint}-${timestamp}.json` : `${type}-${timestamp}.json`
}

/**
 * Ensures that an ACE subdirectory exists, creating it if necessary.
 * @param baseDir - The base project directory (defaults to current working directory)
 * @param subdir - The ACE subdirectory name (e.g., 'deltas', 'reflections', 'executor-outputs')
 * @returns The absolute path to the subdirectory
 */
export async function ensureAceDirectory(baseDir: string | undefined, subdir: string): Promise<string> {
  const resolvedBaseDir = baseDir ?? process.cwd()
  const aceSubdir = join(resolvedBaseDir, BR_DIR, ACE_DIR, subdir)

  await mkdir(aceSubdir, {recursive: true})

  return aceSubdir
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
