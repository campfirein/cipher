import {generateRelationsSection} from './relation-parser.js'

/**
 * Context data for generating context.md files.
 */
export interface ContextData {
  name: string
  relations?: string[]
  snippets: string[]
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
    const timestamp = new Date().toISOString()
    const snippets = data.snippets || []
    const relations = data.relations || []

    const relationsSection = generateRelationsSection(relations)

    return `# ${data.name}

**Last Updated**: ${timestamp}
${relationsSection}
## Context

${snippets.length > 0 ? snippets.map(s => `${s}`).join('\n\n---\n\n') : 'No context available.'}
`
  },
}
