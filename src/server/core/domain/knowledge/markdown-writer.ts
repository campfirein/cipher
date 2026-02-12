import {dump as yamlDump, load as yamlLoad} from 'js-yaml'

import { normalizeRelationPath, parseRelations } from './relation-parser.js'

export interface RawConcept {
  author?: string
  changes?: string[]
  files?: string[]
  flow?: string
  patterns?: Array<{description: string; flags?: string; pattern: string;}>
  task?: string
  timestamp?: string
}

export interface Narrative {
  dependencies?: string
  diagrams?: Array<{content: string; title?: string; type: string}>
  examples?: string
  highlights?: string
  rules?: string
  structure?: string
}

export interface ContextData {
  keywords: string[]
  name: string
  narrative?: Narrative
  rawConcept?: RawConcept
  relations?: string[]
  snippets: string[]
  tags: string[]
}

interface Frontmatter {
  keywords: string[]
  related: string[]
  tags: string[]
  title?: string
}

interface ParsedFrontmatter {
  body: string
  frontmatter: Frontmatter
}

/**
 * Generate YAML frontmatter block from context data.
 * Only includes fields that have values.
 */
function generateFrontmatter(title: string, relations?: string[], tags: string[] = [], keywords: string[] = []): string {
  const normalizedRelations = (relations || []).map(rel => normalizeRelationPath(rel))

  const fm: Record<string, string | string[]> = {}

  if (title) {
    fm.title = title
  }

  fm.tags = tags

  if (normalizedRelations.length > 0) {
    fm.related = normalizedRelations
  }

  fm.keywords = keywords

  // Always generate frontmatter since tags and keywords are required
  const yamlContent = yamlDump(fm, { flowLevel: 1, lineWidth: -1, sortKeys: false }).trimEnd()

  return `---\n${yamlContent}\n---\n`
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns null if no frontmatter is found (backward compat with old format).
 */
function parseFrontmatter(content: string): null | ParsedFrontmatter {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null
  }

  const endIndex = content.indexOf('\n---\n', 4)
  const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
  const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex

  if (actualEnd < 0) {
    return null
  }

  const yamlBlock = content.slice(4, actualEnd)
  const bodyStart = content.indexOf('\n', actualEnd + 1) + 1
  const body = content.slice(bodyStart)

  try {
    const parsed = yamlLoad(yamlBlock) as null | Record<string, unknown>

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const frontmatter: Frontmatter = {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k): k is string => typeof k === 'string') : [],
      related: Array.isArray(parsed.related) ? parsed.related.filter((r): r is string => typeof r === 'string') : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
    }

    if (typeof parsed.title === 'string') {
      frontmatter.title = parsed.title
    }

    return { body, frontmatter }
  } catch {
    return null
  }
}

/**
 * Normalizes newline characters in text.
 * Converts literal \n strings to actual newlines.
 */
function normalizeNewlines(text: string): string {
  return text.replaceAll(String.raw`\n`, '\n');
}

function generateRawConceptSection(rawConcept?: RawConcept): string {
  if (!rawConcept) {
    return ''
  }

  const parts: string[] = []

  if (rawConcept.task) {
    parts.push(`**Task:**\n${normalizeNewlines(rawConcept.task)}`)
  }

  if (rawConcept.changes && rawConcept.changes.length > 0) {
    parts.push(`**Changes:**\n${rawConcept.changes.map(c => `- ${normalizeNewlines(c)}`).join('\n')}`)
  }

  if (rawConcept.files && rawConcept.files.length > 0) {
    parts.push(`**Files:**\n${rawConcept.files.map(f => `- ${normalizeNewlines(f)}`).join('\n')}`)
  }

  if (rawConcept.flow) {
    parts.push(`**Flow:**\n${normalizeNewlines(rawConcept.flow)}`)
  }

  if (rawConcept.timestamp) {
    parts.push(`**Timestamp:** ${normalizeNewlines(rawConcept.timestamp)}`)
  }

  if (rawConcept.author) {
    parts.push(`**Author:** ${rawConcept.author}`)
  }

  if (rawConcept.patterns && rawConcept.patterns.length > 0) {
    const patternsText = rawConcept.patterns.map(p =>
      `- \`${p.pattern}\`${p.flags ? ` (flags: ${p.flags})` : ''} - ${p.description}`
    ).join('\n')
    parts.push(`**Patterns:**\n${patternsText}`)
  }

  if (parts.length === 0) {
    return ''
  }

  return `\n## Raw Concept\n${parts.join('\n\n')}\n`
}

function generateNarrativeSection(narrative?: Narrative): string {
  if (!narrative) {
    return ''
  }

  const parts: string[] = []

  if (narrative.structure) {
    parts.push(`### Structure\n${normalizeNewlines(narrative.structure)}`)
  }

  if (narrative.dependencies) {
    parts.push(`### Dependencies\n${normalizeNewlines(narrative.dependencies)}`)
  }

  if (narrative.highlights) {
    parts.push(`### Highlights\n${normalizeNewlines(narrative.highlights)}`)
  }

  if (narrative.rules) {
    parts.push(`### Rules\n${narrative.rules}`)
  }

  if (narrative.examples) {
    parts.push(`### Examples\n${narrative.examples}`)
  }

  if (narrative.diagrams && narrative.diagrams.length > 0) {
    const diagramParts = narrative.diagrams.map(d => {
      const lang = d.type === 'ascii' ? '' : d.type
      const titleLine = d.title ? `**${d.title}**\n` : ''
      return `${titleLine}\`\`\`${lang}\n${d.content}\n\`\`\``
    })
    parts.push(`### Diagrams\n${diagramParts.join('\n\n')}`)
  }

  if (parts.length === 0) {
    return ''
  }

  return `\n## Narrative\n${parts.join('\n\n')}\n`
}

function parseRawConceptSection(content: string): RawConcept | undefined {
  // Forgiving regex: allows optional whitespace after "## Raw Concept"
  const rawConceptMatch = content.match(/##\s*Raw Concept\s*\n([\s\S]*?)(?=\n##\s|\n---\n|$)/i)
  if (!rawConceptMatch) {
    return undefined
  }

  const sectionContent = rawConceptMatch[1]
  const rawConcept: RawConcept = {}

  // Forgiving: allows whitespace around "Task:" and after the newline
  const taskMatch = sectionContent.match(/\*\*\s*Task\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)/i)
  if (taskMatch) {
    rawConcept.task = taskMatch[1].trim()
  }

  const changesMatch = sectionContent.match(/\*\*\s*Changes\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)/i)
  if (changesMatch) {
    rawConcept.changes = changesMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2))
  }

  const filesMatch = sectionContent.match(/\*\*\s*Files\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)/i)
  if (filesMatch) {
    rawConcept.files = filesMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2))
  }

  const flowMatch = sectionContent.match(/\*\*\s*Flow\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)/i)
  if (flowMatch) {
    rawConcept.flow = flowMatch[1].trim()
  }

  // Timestamp can be inline, so more flexible pattern
  const timestampMatch = sectionContent.match(/\*\*\s*Timestamp\s*:\s*\*\*\s*(.+)/i)
  if (timestampMatch) {
    rawConcept.timestamp = timestampMatch[1].trim()
  }

  // Author can be inline
  const authorMatch = sectionContent.match(/\*\*\s*Author\s*:\s*\*\*\s*(.+)/i)
  if (authorMatch) {
    rawConcept.author = authorMatch[1].trim()
  }

  // Patterns is multi-line with list items
  const patternsMatch = sectionContent.match(/\*\*\s*Patterns\s*:\s*\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|$)/i)
  if (patternsMatch) {
    const patterns: Array<{description: string; flags?: string; pattern: string;}> = []
    for (const line of patternsMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('- `'))) {
        const match = line.match(/- `(.+?)`(?:\s*\(flags:\s*(.+?)\))?\s*-\s*(.+)/)
        if (match) {
          patterns.push({
            description: match[3].trim(),
            pattern: match[1],
            ...(match[2] ? {flags: match[2]} : {})
          })
        }
      }

    if (patterns.length > 0) {
      rawConcept.patterns = patterns
    }
  }

  if (Object.keys(rawConcept).length === 0) {
    return undefined
  }

  return rawConcept
}

function parseNarrativeSection(content: string): Narrative | undefined {
  // Forgiving regex: allows optional whitespace after "## Narrative"
  const narrativeMatch = content.match(/##\s*Narrative\s*\n([\s\S]*?)(?=\n##\s[^#]|\n---\n|$)/i)
  if (!narrativeMatch) {
    return undefined
  }

  const sectionContent = narrativeMatch[1]
  const narrative: Narrative = {}

  // Forgiving: allows whitespace after "### Structure"
  const structureMatch = sectionContent.match(/###\s*Structure\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (structureMatch) {
    narrative.structure = structureMatch[1].trim()
  }

  const dependenciesMatch = sectionContent.match(/###\s*Dependencies\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (dependenciesMatch) {
    narrative.dependencies = dependenciesMatch[1].trim()
  }

  const highlightsMatch = sectionContent.match(/###\s*(?:Highlights|Features)\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (highlightsMatch) {
    narrative.highlights = highlightsMatch[1].trim()
  }

  const rulesMatch = sectionContent.match(/###\s*Rules\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (rulesMatch) {
    narrative.rules = rulesMatch[1].trim()
  }

  const examplesMatch = sectionContent.match(/###\s*Examples\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (examplesMatch) {
    narrative.examples = examplesMatch[1].trim()
  }

  const diagramsMatch = sectionContent.match(/###\s*Diagrams\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (diagramsMatch) {
    const diagrams: Array<{content: string; title?: string; type: string}> = []
    const blockRegex = /(?:\*\*(.+?)\*\*\n)?```(\w*)\n([\s\S]*?)```/g
    let match
    while ((match = blockRegex.exec(diagramsMatch[1])) !== null) {
      diagrams.push({
        content: match[3].trimEnd(),
        ...(match[1] ? {title: match[1]} : {}),
        type: match[2] || 'ascii',
      })
    }

    if (diagrams.length > 0) {
      narrative.diagrams = diagrams
    }
  }

  if (Object.keys(narrative).length === 0) {
    return undefined
  }

  return narrative
}

function extractSnippetsFromContent(content: string): string[] {
  let snippetContent = content

  // Forgiving regex patterns for section removal
  const relationsMatch = content.match(/##\s*Relations[\s\S]*?(?=\n[^@\n]|$)/i)
  if (relationsMatch) {
    snippetContent = snippetContent.replace(relationsMatch[0], '').trim()
  }

  const rawConceptMatch = snippetContent.match(/##\s*Raw Concept[\s\S]*?(?=\n##\s|\n---\n|$)/i)
  if (rawConceptMatch) {
    snippetContent = snippetContent.replace(rawConceptMatch[0], '').trim()
  }

  const narrativeMatch = snippetContent.match(/##\s*Narrative[\s\S]*?(?=\n##\s|\n---\n|$)/i)
  if (narrativeMatch) {
    snippetContent = snippetContent.replace(narrativeMatch[0], '').trim()
  }

  const snippets = snippetContent
    .split(/(?:^|\n)---\n/)
    .map(s => s.trim())
    .filter(s => s && s !== 'No context available.')

  return snippets
}

/**
 * Merges two RawConcept objects with the following strategy:
 *
 * **Scalars (task, flow, timestamp)**: Source wins (source.X || target.X)
 * - Rationale: The source represents "new" or "incoming" data that should
 *   take precedence over existing target data for singular values.
 *
 * **Arrays (changes, files)**: Concatenated and deduplicated (target first, then source)
 * - Rationale: For lists, we want to accumulate all entries rather than
 *   replacing them. Target entries are placed first to preserve order.
 *
 * @param source - The incoming/new RawConcept to merge (takes precedence for scalars)
 * @param target - The existing/base RawConcept to merge into
 * @returns Merged RawConcept or undefined if both inputs are empty
 */
function mergeRawConcepts(source?: RawConcept, target?: RawConcept): RawConcept | undefined {
  if (!source && !target) {
    return undefined
  }

  if (!source) return target
  if (!target) return source

  const merged: RawConcept = {}

  // Scalars: source wins (newer data takes precedence)
  merged.task = source.task || target.task
  merged.flow = source.flow || target.flow
  merged.timestamp = source.timestamp || target.timestamp
  merged.author = source.author || target.author

  // Arrays: concatenate and deduplicate (target first, then source)
  const allChanges = [...(target.changes || []), ...(source.changes || [])]
  if (allChanges.length > 0) {
    merged.changes = [...new Set(allChanges)]
  }

  const allFiles = [...(target.files || []), ...(source.files || [])]
  if (allFiles.length > 0) {
    merged.files = [...new Set(allFiles)]
  }

  // Patterns: concatenate and deduplicate by pattern+flags
  const allPatterns = [...(target.patterns || []), ...(source.patterns || [])]
  if (allPatterns.length > 0) {
    const seen = new Set<string>()
    merged.patterns = allPatterns.filter(p => {
      const key = p.pattern + (p.flags || '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  if (Object.keys(merged).length === 0) {
    return undefined
  }

  return merged
}

function mergeNarratives(source?: Narrative, target?: Narrative): Narrative | undefined {
  if (!source && !target) {
    return undefined
  }

  if (!source) return target
  if (!target) return source

  const merged: Narrative = {}

  if (source.structure || target.structure) {
    const parts = [target.structure, source.structure].filter(Boolean)
    merged.structure = parts.join('\n\n')
  }

  if (source.dependencies || target.dependencies) {
    const parts = [target.dependencies, source.dependencies].filter(Boolean)
    merged.dependencies = parts.join('\n\n')
  }

  if (source.highlights || target.highlights) {
    const parts = [target.highlights, source.highlights].filter(Boolean)
    merged.highlights = parts.join('\n\n')
  }

  if (source.rules || target.rules) {
    const parts = [target.rules, source.rules].filter(Boolean)
    merged.rules = parts.join('\n\n')
  }

  if (source.examples || target.examples) {
    const parts = [target.examples, source.examples].filter(Boolean)
    merged.examples = parts.join('\n\n')
  }

  if (source.diagrams || target.diagrams) {
    const allDiagrams = [...(target.diagrams || []), ...(source.diagrams || [])]
    const seen = new Set<string>()
    merged.diagrams = allDiagrams.filter(d => {
      if (seen.has(d.content)) return false
      seen.add(d.content)
      return true
    })
  }

  if (Object.keys(merged).length === 0) {
    return undefined
  }

  return merged
}

/**
 * Parse content extracting relations from either frontmatter or legacy @ format.
 * Returns parsed frontmatter metadata and the body content for further parsing.
 */
function parseContentWithFrontmatter(content: string): {
  body: string
  keywords: string[]
  relations: string[]
  tags: string[]
  title?: string
} {
  const parsed = parseFrontmatter(content)

  if (parsed) {
    return {
      body: parsed.body,
      keywords: parsed.frontmatter.keywords,
      relations: parsed.frontmatter.related,
      tags: parsed.frontmatter.tags,
      title: parsed.frontmatter.title,
    }
  }

  // Legacy format: parse @ relations from body
  return {
    body: content,
    keywords: [],
    relations: parseRelations(content),
    tags: [],
  }
}

export const MarkdownWriter = {
  generateContext(data: ContextData): string {
    const snippets = (data.snippets || []).filter(s => s && s.trim())
    const relations = data.relations || []

    const frontmatter = generateFrontmatter(data.name, relations, data.tags, data.keywords)
    const rawConceptSection = generateRawConceptSection(data.rawConcept)
    const narrativeSection = generateNarrativeSection(data.narrative)

    const hasSnippets = snippets.length > 0

    // Build the content parts
    const parts: string[] = []

    // Add sections (rawConcept, narrative) — relations are now in frontmatter
    const sectionsContent = `${rawConceptSection}${narrativeSection}`.trim()
    if (sectionsContent) {
      parts.push(sectionsContent)
    }

    // Add snippets if present
    if (hasSnippets) {
      const snippetsContent = snippets.join('\n\n---\n\n')
      parts.push(snippetsContent)
    }

    // If nothing at all, return empty (should not happen in practice)
    if (parts.length === 0 && !frontmatter) {
      return ''
    }

    // Join parts with separator only if we have both sections and snippets
    const body = parts.length > 0 ? parts.join('\n\n---\n\n') + '\n' : ''

    return `${frontmatter}${body}`
  },

  mergeContexts(sourceContent: string, targetContent: string): string {
    const sourceParsed = parseContentWithFrontmatter(sourceContent)
    const targetParsed = parseContentWithFrontmatter(targetContent)
    const mergedRelations = [...new Set([...sourceParsed.relations, ...targetParsed.relations])]

    const mergedTags = [...new Set([...sourceParsed.tags, ...targetParsed.tags])]
    const mergedKeywords = [...new Set([...sourceParsed.keywords, ...targetParsed.keywords])]

    const sourceRawConcept = parseRawConceptSection(sourceParsed.body)
    const targetRawConcept = parseRawConceptSection(targetParsed.body)
    const mergedRawConcept = mergeRawConcepts(sourceRawConcept, targetRawConcept)

    const sourceNarrative = parseNarrativeSection(sourceParsed.body)
    const targetNarrative = parseNarrativeSection(targetParsed.body)
    const mergedNarrative = mergeNarratives(sourceNarrative, targetNarrative)

    const sourceSnippets = extractSnippetsFromContent(sourceParsed.body)
    const targetSnippets = extractSnippetsFromContent(targetParsed.body)

    const seenSnippets = new Set<string>()
    const mergedSnippets: string[] = []

    for (const snippet of [...targetSnippets, ...sourceSnippets]) {
      if (!seenSnippets.has(snippet)) {
        seenSnippets.add(snippet)
        mergedSnippets.push(snippet)
      }
    }

    return MarkdownWriter.generateContext({
      keywords: mergedKeywords,
      name: sourceParsed.title || targetParsed.title || '',
      narrative: mergedNarrative,
      rawConcept: mergedRawConcept,
      relations: mergedRelations,
      snippets: mergedSnippets,
      tags: mergedTags,
    })
  },

  parseContent(content: string, name: string = ''): ContextData {
    const { body, keywords, relations, tags, title } = parseContentWithFrontmatter(content)

    return {
      keywords,
      name: title || name,
      narrative: parseNarrativeSection(body),
      rawConcept: parseRawConceptSection(body),
      relations,
      snippets: extractSnippetsFromContent(body),
      tags,
    }
  },
}
