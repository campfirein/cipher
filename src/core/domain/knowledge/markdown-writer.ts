/**
 * Context data for generating context.md files.
 */
export interface ContextData {
  name: string
  snippets: string[]
}

/**
 * Generates Markdown files for knowledge context.
 */
export const MarkdownWriter = {
  /**
   * Generate context.md content with snippets.
   * Used for both topics and subtopics in the knowledge hierarchy.
   */
  generateContext(data: ContextData): string {
    const timestamp = new Date().toISOString()
    const snippets = data.snippets || []

    return `# ${data.name}

**Last Updated**: ${timestamp}

## Context

${snippets.length > 0 ? snippets.map(s => `${s}`).join('\n\n---\n\n') : 'No context available.'}
`
  },
}
