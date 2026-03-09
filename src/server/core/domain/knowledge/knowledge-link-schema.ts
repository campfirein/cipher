import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import {BRV_DIR, CONTEXT_TREE_DIR, KNOWLEDGE_LINKS_FILE, PROJECT_CONFIG_FILE} from '../../../constants.js'

// ============================================================================
// Schema
// ============================================================================

export const KnowledgeLinkSchema = z.object({
  addedAt: z.string(),
  alias: z.string().min(1),
  projectRoot: z.string().min(1),
  readOnly: z.literal(true),
})

export const KnowledgeLinksFileSchema = z.object({
  links: z.array(KnowledgeLinkSchema),
  version: z.literal(1),
})

export type KnowledgeLink = z.infer<typeof KnowledgeLinkSchema>
export type KnowledgeLinksFile = z.infer<typeof KnowledgeLinksFileSchema>

// ============================================================================
// Knowledge Source (used by search service)
// ============================================================================

export interface KnowledgeSource {
  alias?: string
  contextTreeRoot: string
  sourceKey: string
  type: 'linked' | 'local'
}

/**
 * Derives a stable, short source key from a canonical path.
 * Uses first 12 hex chars of SHA-256 to avoid alias-based collisions.
 */
export function deriveSourceKey(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12)
}

// ============================================================================
// Load + Validate
// ============================================================================

export interface LoadedKnowledgeLinks {
  links: KnowledgeLink[]
  mtime: number
  sources: KnowledgeSource[]
}

/**
 * Loads and validates `.brv/knowledge-links.json` from a project root.
 *
 * Returns null if the file does not exist.
 * Broken links (target `.brv/` missing) are included in `links` but excluded
 * from `sources` — callers decide how to surface them (status vs search).
 */
export function loadKnowledgeLinks(projectRoot: string): LoadedKnowledgeLinks | null {
  const filePath = join(projectRoot, BRV_DIR, KNOWLEDGE_LINKS_FILE)

  if (!existsSync(filePath)) {
    return null
  }

  const mtime = statSync(filePath).mtimeMs

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {links: [], mtime, sources: []}
  }

  const result = KnowledgeLinksFileSchema.safeParse(raw)
  if (!result.success) {
    return {links: [], mtime, sources: []}
  }

  const sources: KnowledgeSource[] = []

  for (const link of result.data.links) {
    const targetConfigPath = join(link.projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
    if (!existsSync(targetConfigPath)) {
      // Broken link — skip from sources but keep in links for status display
      continue
    }

    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync(link.projectRoot)
    } catch {
      continue
    }

    const contextTreeRoot = join(canonicalRoot, BRV_DIR, CONTEXT_TREE_DIR)
    if (!existsSync(contextTreeRoot)) {
      continue
    }

    sources.push({
      alias: link.alias,
      contextTreeRoot,
      sourceKey: deriveSourceKey(canonicalRoot),
      type: 'linked',
    })
  }

  return {links: result.data.links, mtime, sources}
}

// ============================================================================
// Status helpers
// ============================================================================

export interface KnowledgeLinkStatus {
  alias: string
  contextTreeSize?: number
  projectRoot: string
  valid: boolean
}

/**
 * Validates each knowledge link and returns status for display.
 *
 * A link is valid only when both `.brv/config.json` AND `.brv/context-tree/`
 * exist — matching what loadKnowledgeLinks() requires before including a link
 * in search sources. When valid, `contextTreeSize` counts `.md` files.
 */
export function getKnowledgeLinkStatuses(links: KnowledgeLink[]): KnowledgeLinkStatus[] {
  return links.map((link) => {
    const targetConfigPath = join(link.projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
    const targetContextTree = join(link.projectRoot, BRV_DIR, CONTEXT_TREE_DIR)
    const valid = existsSync(targetConfigPath) && existsSync(targetContextTree)

    let contextTreeSize: number | undefined
    if (valid) {
      contextTreeSize = countMarkdownFiles(targetContextTree)
    }

    return {
      alias: link.alias,
      contextTreeSize,
      projectRoot: link.projectRoot,
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
