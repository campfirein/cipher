/**
 * Utilities for parsing and managing context relations.
 * Relations are expressed using @ notation: @domain/topic or @domain/topic/subtopic
 */

/**
 * Regular expression to match relation paths in markdown content.
 * Matches: @domain/topic or @domain/topic/subtopic
 */
const RELATION_PATTERN = /@([\w-]+)\/([\w-]+)(?:\/([\w-]+))?/g

/**
 * Parse relations from context.md content.
 * Extracts all @domain/topic or @domain/topic/subtopic references.
 *
 * @param content - Markdown content to parse
 * @returns Array of unique relation paths (without @ prefix)
 *
 * @example
 * ```ts
 * const content = `
 * ## Relations
 * @code_style/error-handling
 * @structure/api-endpoints
 * `
 * parseRelations(content) // ['code_style/error-handling', 'structure/api-endpoints']
 * ```
 */
export function parseRelations(content: string): string[] {
  const relations = new Set<string>()

  // Extract all @domain/topic or @domain/topic/subtopic patterns
  const matches = content.matchAll(RELATION_PATTERN)

  for (const match of matches) {
    const [, domain, topic, subtopic] = match
    const relation = subtopic
      ? `${domain}/${topic}/${subtopic}`
      : `${domain}/${topic}`
    relations.add(relation)
  }

  return [...relations]
}

/**
 * Validate a relation path format.
 * Valid formats: domain/topic or domain/topic/subtopic
 *
 * @param path - Relation path to validate (without @ prefix)
 * @returns True if path format is valid
 *
 * @example
 * ```ts
 * validateRelationPath('code_style/error-handling') // true
 * validateRelationPath('code_style/error-handling/try-catch') // true
 * validateRelationPath('invalid') // false
 * validateRelationPath('too/many/parts/here') // false
 * ```
 */
export function validateRelationPath(path: string): boolean {
  const parts = path.split('/')

  // Must have 2 or 3 parts: domain/topic or domain/topic/subtopic
  if (parts.length < 2 || parts.length > 3) {
    return false
  }

  // Each part must be non-empty and contain only valid characters
  const validPartPattern = /^[\w-]+$/
  return parts.every(part => validPartPattern.test(part))
}

/**
 * Resolve a relation path to an absolute file system path.
 *
 * @param basePath - Base path to context tree (e.g., '.brv/context-tree')
 * @param relation - Relation path (e.g., 'domain/topic' or 'domain/topic/subtopic')
 * @returns Absolute path to the context.md file
 *
 * @example
 * ```ts
 * resolveRelationPath('.brv/context-tree', 'code_style/error-handling')
 * // => '.brv/context-tree/code_style/error-handling/context.md'
 *
 * resolveRelationPath('.brv/context-tree', 'structure/api/endpoints')
 * // => '.brv/context-tree/structure/api/endpoints/context.md'
 * ```
 */
export function resolveRelationPath(basePath: string, relation: string): string {
  const parts = relation.split('/')
  return `${basePath}/${parts.join('/')}/context.md`
}

/**
 * Format a relation path using @ notation.
 *
 * @param domain - Domain name
 * @param topic - Topic name
 * @param subtopic - Optional subtopic name
 * @returns Formatted relation string with @ prefix
 *
 * @example
 * ```ts
 * formatRelation('code_style', 'error-handling')
 * // => '@code_style/error-handling'
 *
 * formatRelation('structure', 'api', 'endpoints')
 * // => '@structure/api/endpoints'
 * ```
 */
export function formatRelation(domain: string, topic: string, subtopic?: string): string {
  return subtopic
    ? `@${domain}/${topic}/${subtopic}`
    : `@${domain}/${topic}`
}

/**
 * Normalize a relation path by removing the @ prefix.
 *
 * @param relation - Relation path to normalize
 * @returns Normalized relation path
 *
 * @example
 * ```ts
 * normalizeRelation('code_style/error-handling') // 'code_style/error-handling'
 * normalizeRelation('@code_style/error-handling') // 'code_style/error-handling'
 * normalizeRelation('code_style/error-handling/title.md') // 'code_style/error-handling/title.md'
 * normalizeRelation('@code_style/error-handling/title.md') // 'code_style/error-handling/title.md'
 * ```
 */

export function normalizeRelation(relation: string): string {
  return relation.startsWith('@') ? relation.slice(1) : relation
}

/**
 * Generate the Relations section for context.md.
 * Returns empty string if no relations provided.
 *
 * @param relations - Array of relation paths (without @ prefix)
 * @returns Markdown formatted Relations section or empty string
 *
 * @example
 * ```ts
 * generateRelationsSection(['code_style/error-handling', 'structure/api'])
 * // => '\n## Relations\n@code_style/error-handling\n@structure/api\n'
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
    .map(rel => `@${normalizeRelation(rel)}`)
    .join('\n')

  return `\n## Relations\n${formattedRelations}\n`
}
