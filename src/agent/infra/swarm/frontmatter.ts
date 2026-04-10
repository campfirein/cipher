import {load as yamlLoad} from 'js-yaml'

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the parsed frontmatter object and the markdown body, or null if
 * no valid frontmatter is found.
 *
 * Follows the pattern from summary-frontmatter.ts.
 */
export function parseFrontmatter<T = Record<string, unknown>>(
  content: string,
): null | {body: string; frontmatter: T} {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null
  }

  const lfEnd = content.indexOf('\n---\n', 4)
  const crlfEnd = content.indexOf('\r\n---\r\n', 5)

  const result = findDelimiter(content, lfEnd, crlfEnd)
  if (!result) return null

  try {
    const parsed = yamlLoad(result.yamlBlock) as null | T
    if (!parsed || typeof parsed !== 'object') return null

    return {body: content.slice(result.bodyStart), frontmatter: parsed}
  } catch {
    return null
  }
}

function findDelimiter(
  content: string,
  lfEnd: number,
  crlfEnd: number,
): null | {bodyStart: number; yamlBlock: string} {
  if (lfEnd === -1 && crlfEnd === -1) return null
  if (lfEnd === -1) return {bodyStart: crlfEnd + 7, yamlBlock: content.slice(5, crlfEnd)}

  return {bodyStart: lfEnd + 5, yamlBlock: content.slice(4, lfEnd)}
}
