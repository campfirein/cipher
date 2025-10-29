import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {ACE_DIR, BR_DIR} from '../../constants.js'
import {sanitizeHint} from '../../utils/ace-file-helpers.js'

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
