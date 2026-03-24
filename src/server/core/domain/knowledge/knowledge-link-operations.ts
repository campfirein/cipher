import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {basename, join} from 'node:path'

import {BRV_DIR, KNOWLEDGE_LINKS_FILE, PROJECT_CONFIG_FILE} from '../../../constants.js'
import {
  getKnowledgeLinkStatuses,
  type KnowledgeLink,
  type KnowledgeLinksFile,
  KnowledgeLinksFileSchema,
  type KnowledgeLinkStatus,
  loadKnowledgeLinks,
} from './knowledge-link-schema.js'

// ============================================================================
// Result type
// ============================================================================

export interface OperationResult {
  message: string
  success: boolean
}

// ============================================================================
// Add knowledge link
// ============================================================================

/**
 * Adds a read-only knowledge link to another project's context tree.
 *
 * Validates: target is a brv project, not self, not duplicate, not circular.
 * Writes to `.brv/knowledge-links.json`.
 */
export function addKnowledgeLink(projectRoot: string, targetPath: string, alias?: string): OperationResult {
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
    return {message: 'Cannot link to self.', success: false}
  }

  // 5. Read existing file — refuse to mutate if malformed
  const existing = readKnowledgeLinksFile(projectRoot)
  if (existing.error) {
    return {message: existing.error, success: false}
  }

  // 6. Not duplicate
  const isDuplicate = existing.data.links.some((link) => {
    try {
      return realpathSync(link.projectRoot) === targetRoot
    } catch {
      return link.projectRoot === targetRoot
    }
  })

  if (isDuplicate) {
    return {message: `Already linked to "${targetRoot}".`, success: false}
  }

  // 7. Not circular
  if (detectCircularLink(canonicalProjectRoot, targetRoot)) {
    return {
      message: `Circular link detected: "${basename(targetRoot)}" already links back to this project.`,
      success: false,
    }
  }

  // 8. Derive alias — reject empty/whitespace-only
  if (alias !== undefined && alias.trim() === '') {
    return {message: 'Alias must not be empty.', success: false}
  }

  const derivedAlias = alias ?? basename(targetRoot)

  // 9. Ensure alias uniqueness — append suffix if collision
  const finalAlias = ensureUniqueAlias(derivedAlias, existing.data.links)

  // 10. Append and write
  const newLink: KnowledgeLink = {
    addedAt: new Date().toISOString(),
    alias: finalAlias,
    projectRoot: targetRoot,
    readOnly: true,
  }

  existing.data.links.push(newLink)
  writeKnowledgeLinksFile(projectRoot, existing.data)

  return {message: `Linked to "${targetRoot}" as "${finalAlias}".`, success: true}
}

// ============================================================================
// Remove knowledge link
// ============================================================================

/**
 * Removes a knowledge link by alias or path.
 */
export function removeKnowledgeLink(projectRoot: string, aliasOrPath: string): OperationResult {
  const existing = readKnowledgeLinksFile(projectRoot)
  if (existing.error) {
    return {message: existing.error, success: false}
  }

  if (existing.data.links.length === 0) {
    return {message: 'No knowledge links configured.', success: false}
  }

  // Try match by alias first, then by canonical path
  let matchIndex = existing.data.links.findIndex((link) => link.alias === aliasOrPath)

  if (matchIndex === -1) {
    // Try matching by path
    let canonicalTarget: string
    try {
      canonicalTarget = realpathSync(aliasOrPath)
    } catch {
      canonicalTarget = aliasOrPath
    }

    matchIndex = existing.data.links.findIndex((link) => {
      try {
        return realpathSync(link.projectRoot) === canonicalTarget
      } catch {
        return link.projectRoot === canonicalTarget
      }
    })
  }

  if (matchIndex === -1) {
    return {message: `No knowledge link found matching "${aliasOrPath}".`, success: false}
  }

  const removed = existing.data.links.splice(matchIndex, 1)[0]
  writeKnowledgeLinksFile(projectRoot, existing.data)

  return {message: `Removed knowledge link "${removed.alias}" (${removed.projectRoot}).`, success: true}
}

// ============================================================================
// List knowledge links
// ============================================================================

export interface ListKnowledgeLinksResult {
  error?: string
  statuses: KnowledgeLinkStatus[]
}

/**
 * Returns status for all knowledge links in the project.
 * Surfaces malformed file errors instead of silently returning empty.
 */
export function listKnowledgeLinkStatuses(projectRoot: string): ListKnowledgeLinksResult {
  const existing = readKnowledgeLinksFile(projectRoot)
  if (existing.error) {
    return {error: existing.error, statuses: []}
  }

  if (existing.data.links.length === 0) {
    return {statuses: []}
  }

  return {statuses: getKnowledgeLinkStatuses(existing.data.links)}
}

// ============================================================================
// Circular link detection
// ============================================================================

/**
 * Checks if linking projectRoot → targetRoot would create a circular dependency.
 * A circular link exists if the target project has a knowledge link pointing back
 * to the current project (direct cycle only — no transitive check in v1).
 */
export function detectCircularLink(projectRoot: string, targetRoot: string): boolean {
  const targetLinks = loadKnowledgeLinks(targetRoot)
  if (!targetLinks) {
    return false
  }

  return targetLinks.links.some((link) => {
    try {
      return realpathSync(link.projectRoot) === projectRoot
    } catch {
      return link.projectRoot === projectRoot
    }
  })
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Result of reading the knowledge links file.
 * When the file exists but is malformed, `error` contains a description
 * so callers can surface the problem instead of silently overwriting.
 */
interface ReadResult {
  data: KnowledgeLinksFile
  error?: string
}

function readKnowledgeLinksFile(projectRoot: string): ReadResult {
  const filePath = join(projectRoot, BRV_DIR, KNOWLEDGE_LINKS_FILE)

  if (!existsSync(filePath)) {
    return {data: {links: [], version: 1}}
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {
      data: {links: [], version: 1},
      error: `Malformed ${KNOWLEDGE_LINKS_FILE}: file is not valid JSON. Back up or delete the file to recover.`,
    }
  }

  const result = KnowledgeLinksFileSchema.safeParse(raw)
  if (!result.success) {
    return {
      data: {links: [], version: 1},
      error: `Malformed ${KNOWLEDGE_LINKS_FILE}: schema validation failed. Back up or delete the file to recover.`,
    }
  }

  return {data: result.data}
}

function writeKnowledgeLinksFile(projectRoot: string, data: KnowledgeLinksFile): void {
  const filePath = join(projectRoot, BRV_DIR, KNOWLEDGE_LINKS_FILE)
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function ensureUniqueAlias(baseAlias: string, existingLinks: KnowledgeLink[]): string {
  const existingAliases = new Set(existingLinks.map((link) => link.alias))

  if (!existingAliases.has(baseAlias)) {
    return baseAlias
  }

  let counter = 2
  while (existingAliases.has(`${baseAlias}-${counter}`)) {
    counter++
  }

  return `${baseAlias}-${counter}`
}
