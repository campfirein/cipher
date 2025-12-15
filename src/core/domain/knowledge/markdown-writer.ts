import {generateRelationsSection, parseRelations} from './relation-parser.js'

/**
 * Context data for generating context.md files.
 */
export interface ContextData {
  name: string
  relations?: string[]
  snippets: string[]
}

/**
 * Extract snippets from context.md content.
 * Removes relations section and splits by separator.
 */
function extractSnippetsFromContent(content: string): string[] {
  // Remove relations section if present
  let snippetContent = content
  const relationsMatch = content.match(/## Relations[\s\S]*?(?=\n[^@\n]|$)/)
  if (relationsMatch) {
    snippetContent = content.replace(relationsMatch[0], '').trim()
  }

  // Split by separator and filter empty
  const snippets = snippetContent
    .split(/\n---\n/)
    .map(s => s.trim())
    .filter(s => s && s !== 'No context available.')

  return snippets
}

/**
 * Generates Markdown files for knowledge context.
 */
export const MarkdownWriter = {
  /**
   * Generate context.md content with snippets and optional relations.
   * Used for both topics and subtopics in the knowledge hierarchy.
   */
  generateContext(data: ContextData): string {
    const snippets = data.snippets || []
    const relations = data.relations || []

    const relationsSection = generateRelationsSection(relations)

    return `${relationsSection}
${snippets.length > 0 ? snippets.map(s => `${s}`).join('\n\n---\n\n') : 'No context available.'}
`
  },

  /**
   * Merge two context.md contents into one.
   * Combines snippets and relations, deduplicating where possible.
   *
   * @param sourceContent - Raw content from source context.md
   * @param targetContent - Raw content from target context.md
   * @returns Merged context.md content
   */
  mergeContexts(sourceContent: string, targetContent: string): string {
    // Extract relations from both contents
    const sourceRelations = parseRelations(sourceContent)
    const targetRelations = parseRelations(targetContent)

    // Merge and deduplicate relations
    const mergedRelations = [...new Set([...sourceRelations, ...targetRelations])]

    const sourceSnippets = extractSnippetsFromContent(sourceContent)
    const targetSnippets = extractSnippetsFromContent(targetContent)

    // Merge snippets (target first, then source)
    // Deduplicate by exact match
    const seenSnippets = new Set<string>()
    const mergedSnippets: string[] = []

    for (const snippet of [...targetSnippets, ...sourceSnippets]) {
      if (!seenSnippets.has(snippet)) {
        seenSnippets.add(snippet)
        mergedSnippets.push(snippet)
      }
    }

    // Generate merged content
    const relationsSection = generateRelationsSection(mergedRelations)

    return `${relationsSection}
${mergedSnippets.length > 0 ? mergedSnippets.join('\n\n---\n\n') : 'No context available.'}
`
  },
}
