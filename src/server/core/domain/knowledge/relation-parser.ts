/**
 * Utilities for parsing and managing context relations.
 * Relations are expressed using @ notation: @domain/topic/title.md or @domain/topic/subtopic/title.md
 */

/**
 * Regular expression to match relation paths in markdown content.
 * Matches: @domain/topic/title.md or @domain/topic/subtopic/title.md
 */
const RELATION_PATTERN = /@([\w-]+\/[\w-]+(?:\/[\w-]+)?\/[\w-]+(?:\.[\w]+)?)(?![\w/-])/g
/**
 * Parse relations from title.md content.
 * Extracts all @domain/topic/title.md or @domain/topic/subtopic/title.md references.
 *
 * @param content - Markdown content to parse
 * @returns Array of unique relation paths (without @ prefix)
 *
 * @example
 * ```ts
 * const content = `
 * ## Relations
 * @code_style/error-handling/overview.md
 * @structure/api/endpoints/rest.md
 * `
 * parseRelations(content) // ['code_style/error-handling/overview.md', 'structure/api/endpoints/rest.md']
 * ```
 */
export function parseRelations(content: string): string[] {
  const relations = new Set<string>()

  // Extract all @domain/topic/title.md or @domain/topic/subtopic/title.md patterns
  const matches = content.matchAll(RELATION_PATTERN)

  for (const match of matches) {
    const [, fullPath] = match
    relations.add(fullPath.trim())
  }

  return [...relations]
}

/**
 * Resolve a relation path to an absolute file system path.
 *
 * @param basePath - Base path to context tree (e.g., '.brv/context-tree')
 * @param relation - Relation path (e.g., 'domain/topic/title.md' or 'domain/topic/subtopic/title.md')
 * @returns Absolute path to the title.md file
 *
 * @example
 * ```ts
 * resolveRelationPath('.brv/context-tree', 'code_style/error-handling/overview.md')
 * // => '.brv/context-tree/code_style/error-handling/overview.md'
 *
 * resolveRelationPath('.brv/context-tree', 'structure/api/endpoints/rest.md')
 * // => '.brv/context-tree/structure/api/endpoints/rest.md'
 * ```
 */
export function resolveRelationPath(basePath: string, relation: string): string {
  return `${basePath}/${relation}`
}

/**
 * Format a relation path using @ notation.
 *
 * @param domain - Domain name
 * @param topic - Topic name
 * @param title - Title (with .md extension)
 * @param subtopic - Optional subtopic name
 * @returns Formatted relation string with @ prefix
 *
 * @example
 * ```ts
 * formatRelation('code_style', 'error-handling', 'overview.md')
 * // => '@code_style/error-handling/overview.md'
 *
 * formatRelation('structure', 'api', 'endpoints', 'rest.md')
 * // => '@structure/api/endpoints/rest.md'
 * ```
 */
export function formatRelation(domain: string, topic: string, title: string, subtopic?: string): string {
  return subtopic
    ? `@${domain}/${topic}/${subtopic}/${title}`
    : `@${domain}/${topic}/${title}`
}

/**
 * Normalize a relation path by removing the @ prefix.
 * Preserves file extensions (e.g., .md).
 *
 * @param relation - Relation path to normalize
 * @returns Normalized relation path without @ prefix (file extension preserved)
 *
 * @example
 * ```ts
 * normalizeRelation('code_style/error-handling.md') // 'code_style/error-handling.md'
 * normalizeRelation('@code_style/error-handling.md') // 'code_style/error-handling.md'
 * normalizeRelation('code_style/error-handling/title.md') // 'code_style/error-handling/title.md'
 * normalizeRelation('code_style/error-handling/file.md') // 'code_style/error-handling/file.md'
 * ```
 */

export function normalizeRelation(relation: string): string {
  return relation.replace(/^@+/, '')
}

/**
 * Normalize a relation path: remove @ prefix, ensure .md extension,
 * lowercase, and replace spaces with underscores.
 *
 * @param relation - Relation path (with or without @ prefix)
 * @returns Normalized relation path
 *
 * @example
 * ```ts
 * normalizeRelationPath('Architecture/Agents/Overview.md') // 'architecture/agents/overview.md'
 * normalizeRelationPath('@code_style/error-handling/overview') // 'code_style/error-handling/overview.md'
 * normalizeRelationPath('Architecture/Agents/Sandbox and Security.md') // 'architecture/agents/sandbox_and_security.md'
 * ```
 */
export function normalizeRelationPath(relation: string): string {
  const normalized = normalizeRelation(relation)
  const withExtension = normalized.endsWith('.md') ? normalized : `${normalized}.md`

  return withExtension.toLowerCase().replaceAll(/\s+/g, '_')
}

/**
 * Generate the Relations section for context.md.
 * Returns empty string if no relations provided.
 * @deprecated Use frontmatter `related` field instead. Kept for backward compatibility.
 *
 * @param relations - Array of relation paths (with or without @ prefix)
 * @returns Markdown formatted Relations section or empty string
 *
 * @example
 * ```ts
 * generateRelationsSection(['code_style/error-handling/overview.md', 'structure/api/rest.md'])
 * // => '\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/rest.md\n'
 *
 * generateRelationsSection(['Architecture/Agents/Overview.md', 'Architecture/Agents/Sandbox and Security.md'])
 * // => '\n## Relations\n@architecture/agents/overview.md\n@architecture/agents/sandbox_and_security.md\n'
 *
 * generateRelationsSection([])
 * // => ''
 * ```
 */
export function generateRelationsSection(relations: string[]): string {
  if (relations.length === 0) {
    return ''
  }

  const formattedRelations = relations
    .map(rel => `@${normalizeRelationPath(rel)}`)
    .join('\n')

  return `\n## Relations\n${formattedRelations}\n`
}
