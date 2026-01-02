/**
 * Utilities for parsing and managing context relations.
 * Relations are expressed using @ notation: @domain/topic/title.md or @domain/topic/subtopic/title.md
 */

/**
 * Regular expression to match relation paths in markdown content.
 * Matches: @domain/topic/title.md or @domain/topic/subtopic/title.md
 */
const RELATION_PATTERN = /@([\w-]+\/[\w-]+(?:\/[\w-]+)?\/[\w-]+\.md)/g
const MAXIUM_LEVEL_OF_PATH = 4
const MINIMUM_LEVEL_OF_PATH = 3

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
    relations.add(fullPath)
  }

  return [...relations]
}

/**
 * Validate a relation path format.
 * Valid formats: domain/topic/title.md or domain/topic/subtopic/title.md
 *
 * @param path - Relation path to validate (without @ prefix)
 * @returns True if path format is valid
 *
 * @example
 * ```ts
 * validateRelationPath('code_style/error-handling/overview.md') // true
 * validateRelationPath('code_style/error-handling/try-catch/guide.md') // true
 * validateRelationPath('invalid') // false
 * validateRelationPath('code_style/error-handling') // false (missing title.md)
 * validateRelationPath('too/many/parts/here/extra.md') // false
 * ```
 */
export function validateRelationPath(path: string): boolean {
  const parts = path.split('/')

  // Must have 3 or 4 parts: domain/topic/title.md or domain/topic/subtopic/title.md
  if (parts.length < MINIMUM_LEVEL_OF_PATH || parts.length > MAXIUM_LEVEL_OF_PATH) {
    return false
  }

  // Each part except last must be non-empty and contain only valid characters
  const validPartPattern = /^[\w-]+$/
  // Last part must end with .md
  const validTitlePattern = /^[\w-]+\.md$/

  const allPartsExceptLast = parts.slice(0, -1)
  const lastPart = parts.at(-1) ?? ''

  return allPartsExceptLast.every(part => validPartPattern.test(part)) && validTitlePattern.test(lastPart)
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
 * @param title - Title with .md extension
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
 *
 * @param relation - Relation path to normalize
 * @returns Normalized relation path
 *
 * @example
 * ```ts
 * normalizeRelation('code_style/error-handling') // 'code_style/error-handling'
 * normalizeRelation('@code_style/error-handling') // 'code_style/error-handling'
 * normalizeRelation('code_style/error-handling/title.md') // 'code_style/error-handling/title.md'
 * normalizeRelation('@@@code_style/error-handling/title.md') // 'code_style/error-handling/title.md'
 * ```
 */

export function normalizeRelation(relation: string): string {
  return relation.replace(/^@+/, '')
}

/**
 * Generate the Relations section for context.md.
 * Returns empty string if no relations provided.
 *
 * @param relations - Array of relation paths (with or without @ prefix)
 * @returns Markdown formatted Relations section or empty string
 *
 * @example
 * ```ts
 * generateRelationsSection(['code_style/error-handling/overview', 'structure/api/rest'])
 * // => '\n## Relations\n@code_style/error-handling/overview.md\n@structure/api/rest.md\n'
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
    .map(rel => `@${normalizeRelation(rel)}.md`)
    .join('\n')

  return `\n## Relations\n${formattedRelations}\n`
}
