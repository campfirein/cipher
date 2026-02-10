import { generateRelationsSection, parseRelations } from './relation-parser.js'

export interface RawConcept {
  changes?: string[]
  files?: string[]
  flow?: string
  task?: string
  timestamp?: string
}

export interface Narrative {
  dependencies?: string
  features?: string
  structure?: string
}

export interface ContextData {
  name: string
  narrative?: Narrative
  rawConcept?: RawConcept
  relations?: string[]
  snippets: string[]
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

  if (narrative.features) {
    parts.push(`### Features\n${normalizeNewlines(narrative.features)}`)
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

  const featuresMatch = sectionContent.match(/###\s*Features\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i)
  if (featuresMatch) {
    narrative.features = featuresMatch[1].trim()
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
    .split(/\n---\n/)
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

  // Arrays: concatenate and deduplicate (target first, then source)
  const allChanges = [...(target.changes || []), ...(source.changes || [])]
  if (allChanges.length > 0) {
    merged.changes = [...new Set(allChanges)]
  }

  const allFiles = [...(target.files || []), ...(source.files || [])]
  if (allFiles.length > 0) {
    merged.files = [...new Set(allFiles)]
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

  if (source.features || target.features) {
    const parts = [target.features, source.features].filter(Boolean)
    merged.features = parts.join('\n\n')
  }

  if (Object.keys(merged).length === 0) {
    return undefined
  }

  return merged
}

export const MarkdownWriter = {
  generateContext(data: ContextData): string {
    const snippets = (data.snippets || []).filter(s => s && s.trim())
    const relations = data.relations || []

    const relationsSection = generateRelationsSection(relations)
    const rawConceptSection = generateRawConceptSection(data.rawConcept)
    const narrativeSection = generateNarrativeSection(data.narrative)

    const hasSnippets = snippets.length > 0

    // Build the content parts
    const parts: string[] = []

    // Add sections (relations, rawConcept, narrative)
    const sectionsContent = `${relationsSection}${rawConceptSection}${narrativeSection}`.trim()
    if (sectionsContent) {
      parts.push(sectionsContent)
    }

    // Add snippets if present
    if (hasSnippets) {
      const snippetsContent = snippets.join('\n\n---\n\n')
      parts.push(snippetsContent)
    }

    // If nothing at all, return empty (should not happen in practice)
    if (parts.length === 0) {
      return ''
    }

    // Join parts with separator only if we have both sections and snippets
    return parts.join('\n\n---\n\n') + '\n'
  },

  mergeContexts(sourceContent: string, targetContent: string): string {
    const sourceRelations = parseRelations(sourceContent)
    const targetRelations = parseRelations(targetContent)
    const mergedRelations = [...new Set([...sourceRelations, ...targetRelations])]

    const sourceRawConcept = parseRawConceptSection(sourceContent)
    const targetRawConcept = parseRawConceptSection(targetContent)
    const mergedRawConcept = mergeRawConcepts(sourceRawConcept, targetRawConcept)

    const sourceNarrative = parseNarrativeSection(sourceContent)
    const targetNarrative = parseNarrativeSection(targetContent)
    const mergedNarrative = mergeNarratives(sourceNarrative, targetNarrative)

    const sourceSnippets = extractSnippetsFromContent(sourceContent)
    const targetSnippets = extractSnippetsFromContent(targetContent)

    const seenSnippets = new Set<string>()
    const mergedSnippets: string[] = []

    for (const snippet of [...targetSnippets, ...sourceSnippets]) {
      if (!seenSnippets.has(snippet)) {
        seenSnippets.add(snippet)
        mergedSnippets.push(snippet)
      }
    }

    return MarkdownWriter.generateContext({
      name: '',
      narrative: mergedNarrative,
      rawConcept: mergedRawConcept,
      relations: mergedRelations,
      snippets: mergedSnippets,
    })
  },

  parseContent(content: string, name: string = ''): ContextData {
    return {
      name,
      narrative: parseNarrativeSection(content),
      rawConcept: parseRawConceptSection(content),
      relations: parseRelations(content),
      snippets: extractSnippetsFromContent(content),
    }
  },
}
