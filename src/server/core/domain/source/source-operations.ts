import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {basename, join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, SOURCES_FILE} from '../../../constants.js'
import {
  getSourceStatuses,
  loadSources,
  type Source,
  type SourcesFile,
  SourcesFileSchema,
  type SourceStatus,
} from './source-schema.js'

// ============================================================================
// Result type
// ============================================================================

export interface OperationResult {
  message: string
  success: boolean
}

// ============================================================================
// Add source
// ============================================================================

/**
 * Adds a read-only knowledge source from another project's context tree.
 *
 * Validates: target is a brv project, not self, not duplicate, not circular.
 * Writes to `.brv/sources.json`.
 */
export function addSource(projectRoot: string, targetPath: string, alias?: string): OperationResult {
  // 1. Local project must have .brv/
  const localConfigPath = join(projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
  if (!existsSync(localConfigPath)) {
    return {message: `Current project has no .brv/ — run 'brv' first to initialize.`, success: false}
  }

  // 2. Resolve target to canonical path
  let targetRoot: string
  try {
    targetRoot = realpathSync(targetPath)
  } catch {
    return {message: `Target path does not exist: ${targetPath}`, success: false}
  }

  // 3. Target must be a brv project
  const targetConfigPath = join(targetRoot, BRV_DIR, PROJECT_CONFIG_FILE)
  if (!existsSync(targetConfigPath)) {
    return {message: `Target "${targetRoot}" is not a ByteRover project (no .brv/config.json).`, success: false}
  }

  // 4. Not self
  let canonicalProjectRoot: string
  try {
    canonicalProjectRoot = realpathSync(projectRoot)
  } catch {
    canonicalProjectRoot = projectRoot
  }

  if (targetRoot === canonicalProjectRoot) {
    return {message: 'Cannot add a source pointing to the current project.', success: false}
  }

  // 5. Read existing file — refuse to mutate if malformed
  const existing = readSourcesFile(projectRoot)
  if (existing.error) {
    return {message: existing.error, success: false}
  }

  // 6. Not duplicate
  const isDuplicate = existing.data.sources.some((source) => {
    try {
      return realpathSync(source.projectRoot) === targetRoot
    } catch {
      return source.projectRoot === targetRoot
    }
  })

  if (isDuplicate) {
    return {message: `Source "${targetRoot}" already added.`, success: false}
  }

  // 7. Not circular
  if (detectCircularSource(canonicalProjectRoot, targetRoot)) {
    return {
      message: `Circular source detected: "${basename(targetRoot)}" already references this project as a source.`,
      success: false,
    }
  }

  // 8. Derive alias — reject empty/whitespace-only
  if (alias !== undefined && alias.trim() === '') {
    return {message: 'Alias must not be empty.', success: false}
  }

  const derivedAlias = alias ?? basename(targetRoot)

  // 9. Ensure alias uniqueness — append suffix if collision
  const finalAlias = ensureUniqueAlias(derivedAlias, existing.data.sources)

  // 10. Append and write
  const newSource: Source = {
    addedAt: new Date().toISOString(),
    alias: finalAlias,
    projectRoot: targetRoot,
    readOnly: true,
  }

  existing.data.sources.push(newSource)
  writeSourcesFile(projectRoot, existing.data)

  return {message: `Added source "${targetRoot}" as "${finalAlias}".`, success: true}
}

// ============================================================================
// Remove source
// ============================================================================

/**
 * Removes a knowledge source by alias or path.
 */
export function removeSource(projectRoot: string, aliasOrPath: string): OperationResult {
  const existing = readSourcesFile(projectRoot)
  if (existing.error) {
    return {message: existing.error, success: false}
  }

  if (existing.data.sources.length === 0) {
    return {message: 'No knowledge sources configured.', success: false}
  }

  // Try match by alias first, then by canonical path
  let matchIndex = existing.data.sources.findIndex((source) => source.alias === aliasOrPath)

  if (matchIndex === -1) {
    // Try matching by path
    let canonicalTarget: string
    try {
      canonicalTarget = realpathSync(aliasOrPath)
    } catch {
      canonicalTarget = aliasOrPath
    }

    matchIndex = existing.data.sources.findIndex((source) => {
      try {
        return realpathSync(source.projectRoot) === canonicalTarget
      } catch {
        return source.projectRoot === canonicalTarget
      }
    })
  }

  if (matchIndex === -1) {
    return {message: `No source found matching "${aliasOrPath}".`, success: false}
  }

  const removed = existing.data.sources.splice(matchIndex, 1)[0]
  writeSourcesFile(projectRoot, existing.data)

  return {message: `Removed source "${removed.alias}" (${removed.projectRoot}).`, success: true}
}

// ============================================================================
// List sources
// ============================================================================

export interface ListSourcesResult {
  error?: string
  statuses: SourceStatus[]
}

/**
 * Returns status for all sources in the project.
 * Surfaces malformed file errors instead of silently returning empty.
 */
export function listSourceStatuses(projectRoot: string): ListSourcesResult {
  const existing = readSourcesFile(projectRoot)
  if (existing.error) {
    return {error: existing.error, statuses: []}
  }

  if (existing.data.sources.length === 0) {
    return {statuses: []}
  }

  return {statuses: getSourceStatuses(existing.data.sources)}
}

// ============================================================================
// Circular source detection
// ============================================================================

/**
 * Checks if adding projectRoot → targetRoot would create a circular dependency.
 * A circular reference exists if the target project already has a source pointing
 * back to the current project (direct cycle only — no transitive check in v1).
 */
export function detectCircularSource(projectRoot: string, targetRoot: string): boolean {
  const targetSources = loadSources(targetRoot)
  if (!targetSources) {
    return false
  }

  return targetSources.sources.some((source) => {
    try {
      return realpathSync(source.projectRoot) === projectRoot
    } catch {
      return source.projectRoot === projectRoot
    }
  })
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Result of reading the sources file.
 * When the file exists but is malformed, `error` contains a description
 * so callers can surface the problem instead of silently overwriting.
 */
interface ReadResult {
  data: SourcesFile
  error?: string
}

function readSourcesFile(projectRoot: string): ReadResult {
  const filePath = join(projectRoot, BRV_DIR, SOURCES_FILE)

  if (!existsSync(filePath)) {
    return {data: {sources: [], version: 1}}
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {
      data: {sources: [], version: 1},
      error: `Malformed ${SOURCES_FILE}: file is not valid JSON. Back up or delete the file to recover.`,
    }
  }

  const result = SourcesFileSchema.safeParse(raw)
  if (!result.success) {
    return {
      data: {sources: [], version: 1},
      error: `Malformed ${SOURCES_FILE}: schema validation failed. Back up or delete the file to recover.`,
    }
  }

  return {data: result.data}
}

function writeSourcesFile(projectRoot: string, data: SourcesFile): void {
  const filePath = join(projectRoot, BRV_DIR, SOURCES_FILE)
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function ensureUniqueAlias(baseAlias: string, existingSources: Source[]): string {
  const existingAliases = new Set(existingSources.map((source) => source.alias))

  if (!existingAliases.has(baseAlias)) {
    return baseAlias
  }

  let counter = 2
  while (existingAliases.has(`${baseAlias}-${counter}`)) {
    counter++
  }

  return `${baseAlias}-${counter}`
}
