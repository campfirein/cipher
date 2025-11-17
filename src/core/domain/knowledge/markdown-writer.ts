/**
 * Domain data for generating Markdown.
 */
export interface DomainData {
  category: string
  confidence: number
  description: string
  reasoning?: string
  topics?: string[]
}

/**
 * Topic data for generating Markdown.
 */
export interface TopicData {
  confidence: number
  description: string
  domain: string
  name: string
  reasoning?: string
  relatedFiles?: string[]
  subtopics?: string[]
}

/**
 * Subtopic data for generating Markdown.
 */
export interface SubtopicData {
  confidence: number
  description: string
  domain: string
  name: string
  parentTopic: string
  reasoning?: string
  relatedFiles?: string[]
  snippets?: string[]
  tags?: string[]
}

/**
 * Generates Markdown files for knowledge domains, topics, and subtopics.
 */
export const MarkdownWriter = {
  /**
   * Generate domain metadata.md content.
   */
  generateDomainMetadata(domain: DomainData): string {
    const timestamp = new Date().toISOString()
    const topics = domain.topics || []

    return `# ${domain.category}

**Confidence**: ${domain.confidence.toFixed(2)}
**Last Updated**: ${timestamp}${topics.length > 0 ? `  \n**Topics**: ${topics.length}` : ''}

## Description
${domain.description}

${domain.reasoning ? `## Reasoning\n${domain.reasoning}\n\n` : ''}${topics.length > 0 ? `## Topics\n${topics.map(t => `- [${t}](${t}/README.md)`).join('\n')}\n` : ''}
`
  },

  /**
   * Generate subtopic Markdown file content.
   */
  generateSubtopic(subtopic: SubtopicData): string {
    const timestamp = new Date().toISOString()
    const snippets = subtopic.snippets || []
    const related = subtopic.relatedFiles || []
    const tags = subtopic.tags || []

    return `# ${subtopic.name}

**Parent Topic**: ${subtopic.parentTopic}
**Domain**: ${subtopic.domain}
**Confidence**: ${subtopic.confidence.toFixed(2)}
**Timestamp**: ${timestamp}

## Description
${subtopic.description}

${subtopic.reasoning ? `## Reasoning\n${subtopic.reasoning}\n\n` : ''}${snippets.length > 0 ? `## Supporting Evidence\n\n${snippets.map(s => `\`\`\`\n${s}\n\`\`\``).join('\n\n')}\n\n` : ''}${related.length > 0 ? `## Related Files\n${related.map(f => `- \`${f}\``).join('\n')}\n\n` : ''}${tags.length > 0 ? `## Tags\n${tags.map(t => `#${t}`).join(' ')}\n` : ''}
`
  },

  /**
   * Generate topic README.md content.
   */
  generateTopicReadme(topic: TopicData): string {
    const timestamp = new Date().toISOString()
    const subtopics = topic.subtopics || []
    const related = topic.relatedFiles || []

    return `# ${topic.name}

**Domain**: ${topic.domain}
**Confidence**: ${topic.confidence.toFixed(2)}
**Last Updated**: ${timestamp}

## Description
${topic.description}

${topic.reasoning ? `## Reasoning\n${topic.reasoning}\n\n` : ''}${subtopics.length > 0 ? `## Subtopics\n${subtopics.map(s => `- [${s}](${s}.md)`).join('\n')}\n\n` : ''}${related.length > 0 ? `## Related Files\n${related.map(f => `- \`${f}\``).join('\n')}\n` : ''}
`
  },
}
