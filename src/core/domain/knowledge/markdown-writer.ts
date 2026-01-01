import {generateRelationsSection, parseRelations} from './relation-parser.js'

export interface RawConcept {
  changes?: string[]
  files?: string[]
  flow?: string
  task?: string
  timestamp?: string
}

export interface Narrative {
  features?: string
  dependencies?: string
  structure?: string
}

export interface ContextData {
  name: string
  narrative?: Narrative
  rawConcept?: RawConcept
  relations?: string[]
  snippets: string[]
}

function generateRawConceptSection(rawConcept?: RawConcept): string {
  if (!rawConcept) {
    return ''
  }

  const parts: string[] = []

  if (rawConcept.task) {
    parts.push(`**Task:**\n${rawConcept.task}`)
  }

  if (rawConcept.changes && rawConcept.changes.length > 0) {
    parts.push(`**Changes:**\n${rawConcept.changes.map(c => `- ${c}`).join('\n')}`)
  }

  if (rawConcept.files && rawConcept.files.length > 0) {
    parts.push(`**Files:**\n${rawConcept.files.map(f => `- ${f}`).join('\n')}`)
  }

  if (rawConcept.flow) {
    parts.push(`**Flow:**\n${rawConcept.flow}`)
  }

  if (rawConcept.timestamp) {
    parts.push(`**Timestamp:** ${rawConcept.timestamp}`)
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
    parts.push(`### Structure\n${narrative.structure}`)
  }

  if (narrative.dependencies) {
    parts.push(`### Dependencies\n${narrative.dependencies}`)
  }

  if (narrative.features) {
    parts.push(`### Features\n${narrative.features}`)
  }

  if (parts.length === 0) {
    return ''
  }

  return `\n## Narrative\n${parts.join('\n\n')}\n`
}

function parseRawConceptSection(content: string): RawConcept | undefined {
  const rawConceptMatch = content.match(/## Raw Concept\n([\s\S]*?)(?=\n## |\n---\n|$)/)
  if (!rawConceptMatch) {
    return undefined
  }

  const sectionContent = rawConceptMatch[1]
  const rawConcept: RawConcept = {}

  const taskMatch = sectionContent.match(/\*\*Task:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)/)
  if (taskMatch) {
    rawConcept.task = taskMatch[1].trim()
  }

  const changesMatch = sectionContent.match(/\*\*Changes:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)/)
  if (changesMatch) {
    rawConcept.changes = changesMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2))
  }

  const filesMatch = sectionContent.match(/\*\*Files:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)/)
  if (filesMatch) {
    rawConcept.files = filesMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2))
  }

  const flowMatch = sectionContent.match(/\*\*Flow:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)/)
  if (flowMatch) {
    rawConcept.flow = flowMatch[1].trim()
  }

  const timestampMatch = sectionContent.match(/\*\*Timestamp:\*\* (.+)/)
  if (timestampMatch) {
    rawConcept.timestamp = timestampMatch[1].trim()
  }

  if (Object.keys(rawConcept).length === 0) {
    return undefined
  }

  return rawConcept
}

function parseNarrativeSection(content: string): Narrative | undefined {
  const narrativeMatch = content.match(/## Narrative\n([\s\S]*?)(?=\n## [^#]|\n---\n|$)/)
  if (!narrativeMatch) {
    return undefined
  }

  const sectionContent = narrativeMatch[1]
  const narrative: Narrative = {}

  const structureMatch = sectionContent.match(/### Structure\n([\s\S]*?)(?=\n### |\n## |$)/)
  if (structureMatch) {
    narrative.structure = structureMatch[1].trim()
  }

  const dependenciesMatch = sectionContent.match(/### Dependencies\n([\s\S]*?)(?=\n### |\n## |$)/)
  if (dependenciesMatch) {
    narrative.dependencies = dependenciesMatch[1].trim()
  }

  const featuresMatch = sectionContent.match(/### Features\n([\s\S]*?)(?=\n### |\n## |$)/)
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

  const relationsMatch = content.match(/## Relations[\s\S]*?(?=\n[^@\n]|$)/)
  if (relationsMatch) {
    snippetContent = snippetContent.replace(relationsMatch[0], '').trim()
  }

  const rawConceptMatch = snippetContent.match(/## Raw Concept[\s\S]*?(?=\n## |\n---\n|$)/)
  if (rawConceptMatch) {
    snippetContent = snippetContent.replace(rawConceptMatch[0], '').trim()
  }

  const narrativeMatch = snippetContent.match(/## Narrative[\s\S]*?(?=\n## |\n---\n|$)/)
  if (narrativeMatch) {
    snippetContent = snippetContent.replace(narrativeMatch[0], '').trim()
  }

  const snippets = snippetContent
    .split(/\n---\n/)
    .map(s => s.trim())
    .filter(s => s && s !== 'No context available.')

  return snippets
}

function mergeRawConcepts(source?: RawConcept, target?: RawConcept): RawConcept | undefined {
  if (!source && !target) {
    return undefined
  }

  if (!source) return target
  if (!target) return source

  const merged: RawConcept = {}

  merged.task = source.task || target.task

  const allChanges = [...(target.changes || []), ...(source.changes || [])]
  if (allChanges.length > 0) {
    merged.changes = [...new Set(allChanges)]
  }

  const allFiles = [...(target.files || []), ...(source.files || [])]
  if (allFiles.length > 0) {
    merged.files = [...new Set(allFiles)]
  }

  merged.flow = source.flow || target.flow
  merged.timestamp = source.timestamp || target.timestamp

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
    const snippets = data.snippets || []
    const relations = data.relations || []

    const relationsSection = generateRelationsSection(relations)
    const rawConceptSection = generateRawConceptSection(data.rawConcept)
    const narrativeSection = generateNarrativeSection(data.narrative)

    const snippetsContent = snippets.length > 0
      ? snippets.map(s => `${s}`).join('\n\n---\n\n')
      : 'No context available.'

    const hasSections = relationsSection || rawConceptSection || narrativeSection
    const sectionsSeparator = hasSections ? '\n---\n\n' : ''

    return `${relationsSection}${rawConceptSection}${narrativeSection}${sectionsSeparator}${snippetsContent}
`
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
