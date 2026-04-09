import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import {BRV_DIR, CONTEXT_TREE_DIR, PROJECT_CONFIG_FILE, SOURCES_FILE} from '../../../constants.js'

// ============================================================================
// Schema
// ============================================================================

export const SourceSchema = z.object({
  addedAt: z.string(),
  alias: z.string().min(1),
  projectRoot: z.string().min(1),
  readOnly: z.literal(true),
})

export const SourcesFileSchema = z.object({
  sources: z.array(SourceSchema),
  version: z.literal(1),
})

export type Source = z.infer<typeof SourceSchema>
export type SourcesFile = z.infer<typeof SourcesFileSchema>

// ============================================================================
// SearchOrigin (used by search service to identify the origin of indexed docs)
// ============================================================================

export interface SearchOrigin {
  alias?: string
  contextTreeRoot: string
  origin: 'local' | 'shared'
  originKey: string
}

/**
 * Derives a stable, short origin key from a canonical path.
 * Uses first 12 hex chars of SHA-256 to avoid alias-based collisions.
 */
export function deriveOriginKey(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12)
}

// ============================================================================
// Load + Validate
// ============================================================================

export interface LoadedSources {
  mtime: number
  /** Search origins derived from valid sources (callers can search them) */
  origins: SearchOrigin[]
  /** All configured sources (including broken ones — for status display) */
  sources: Source[]
}

/**
 * Loads and validates `.brv/sources.json` from a project root.
 *
 * Returns null if the file does not exist.
 * Broken sources (target `.brv/` missing) are included in `sources` but excluded
 * from `origins` — callers decide how to surface them (status vs search).
 */
export function loadSources(projectRoot: string): LoadedSources | null {
  const filePath = join(projectRoot, BRV_DIR, SOURCES_FILE)

  if (!existsSync(filePath)) {
    return null
  }

  const mtime = statSync(filePath).mtimeMs

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {mtime, origins: [], sources: []}
  }

  const result = SourcesFileSchema.safeParse(raw)
  if (!result.success) {
    return {mtime, origins: [], sources: []}
  }

  const origins: SearchOrigin[] = []

  for (const source of result.data.sources) {
    const targetConfigPath = join(source.projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
    if (!existsSync(targetConfigPath)) {
      // Broken source — skip from origins but keep in sources for status display
      continue
    }

    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync(source.projectRoot)
    } catch {
      continue
    }

    const contextTreeRoot = join(canonicalRoot, BRV_DIR, CONTEXT_TREE_DIR)
    if (!existsSync(contextTreeRoot)) {
      continue
    }

    origins.push({
      alias: source.alias,
      contextTreeRoot,
      origin: 'shared',
      originKey: deriveOriginKey(canonicalRoot),
    })
  }

  return {mtime, origins, sources: result.data.sources}
}

// ============================================================================
// Status helpers
// ============================================================================

export interface SourceStatus {
  alias: string
  contextTreeSize?: number
  projectRoot: string
  valid: boolean
}

/**
 * Validates each source and returns status for display.
 *
 * A source is valid only when both `.brv/config.json` AND `.brv/context-tree/`
 * exist — matching what loadSources() requires before including a source in
 * search origins. When valid, `contextTreeSize` counts `.md` files.
 */
export function getSourceStatuses(sources: Source[]): SourceStatus[] {
  return sources.map((source) => {
    const targetConfigPath = join(source.projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
    const targetContextTree = join(source.projectRoot, BRV_DIR, CONTEXT_TREE_DIR)
    const valid = existsSync(targetConfigPath) && existsSync(targetContextTree)

    let contextTreeSize: number | undefined
    if (valid) {
      contextTreeSize = countMarkdownFiles(targetContextTree)
    }

    return {
      alias: source.alias,
      contextTreeSize,
      projectRoot: source.projectRoot,
      valid,
    }
  })
}

/**
 * Recursively counts .md files in a directory.
 */
function countMarkdownFiles(dir: string): number {
  let count = 0
  try {
    const entries = readdirSync(dir, {withFileTypes: true})
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += countMarkdownFiles(join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++
      }
    }
  } catch {
    // Directory unreadable — return 0
  }

  return count
}
