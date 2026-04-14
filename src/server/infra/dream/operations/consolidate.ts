/**
 * Consolidate operation — merges, updates, and cross-references related context tree files.
 *
 * Flow:
 * 1. Group changed files by domain (first path segment)
 * 2. Per domain: find related files via BM25 search + path siblings
 * 3. Per domain: LLM classifies file relationships → returns actions
 * 4. Execute actions: MERGE (combine + delete source), TEMPORAL_UPDATE (rewrite),
 *    CROSS_REFERENCE (add related links in frontmatter), SKIP (no-op)
 *
 * Never throws — returns partial results on errors.
 */

import {dump as yamlDump, load as yamlLoad} from 'js-yaml'
import {randomUUID} from 'node:crypto'
import {mkdir, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../dream-log-schema.js'
import type {ConsolidationAction} from '../dream-response-schemas.js'

import {parseFrontmatterScoring} from '../../../core/domain/knowledge/markdown-writer.js'
import {ConsolidateResponseSchema} from '../dream-response-schemas.js'
import {parseDreamResponse} from '../parse-dream-response.js'

export type ConsolidateDeps = {
  agent: ICipherAgent
  contextTreeDir: string
  searchService: {
    search(query: string, options?: {limit?: number; scope?: string}): Promise<{results: Array<{path: string; score: number; title: string}>}>
  }
  signal?: AbortSignal
  taskId: string
}

/**
 * Run the consolidation operation on changed files.
 * Returns DreamOperation results (never throws).
 */
export async function consolidate(
  changedFiles: string[],
  deps: ConsolidateDeps,
): Promise<DreamOperation[]> {
  if (changedFiles.length === 0) return []

  // Step 1: Group by domain
  const domainGroups = groupByDomain(changedFiles)

  // Step 2-5: Process each domain sequentially to avoid concurrent file writes
  const allResults: DreamOperation[] = []
  for (const [domain, files] of domainGroups) {
    if (deps.signal?.aborted) break
    // eslint-disable-next-line no-await-in-loop
    const domainOps = await processDomain(domain, files, deps)
    allResults.push(...domainOps)
  }

  return allResults
}

async function processDomain(domain: string, files: string[], deps: ConsolidateDeps): Promise<DreamOperation[]> {
  const {agent, contextTreeDir, searchService, taskId} = deps
  const results: DreamOperation[] = []
  let sessionId: string
  try {
    sessionId = await agent.createTaskSession(taskId, 'dream-consolidate')
  } catch {
    return [] // Session creation failed — skip domain
  }

  try {
    // Step 2: Find related files for each changed file in domain
    const fileContents = new Map<string, string>()
    const relatedPaths = new Set<string>()

    // Sequential: each file's search results may inform the next (shared fileContents map)
    // eslint-disable-next-line no-await-in-loop
    for (const file of files) await loadFileAndRelated(file, domain, contextTreeDir, searchService, fileContents, relatedPaths)

    // Also load sibling .md files from same directories
    await loadSiblings(files, contextTreeDir, fileContents)

    if (fileContents.size === 0) return []

    // Step 3: LLM classification — cap payload to avoid exceeding model context limits
    const filesPayload = capPayloadSize(Object.fromEntries(fileContents), files)

    agent.setSandboxVariableOnSession(sessionId, '__dream_consolidate_files', filesPayload)

    const prompt = buildPrompt(files, [...relatedPaths], Object.keys(filesPayload))
    const response = await agent.executeOnSession(sessionId, prompt, {
      executionContext: {commandType: 'curate', maxIterations: 10},
      signal: deps.signal,
      taskId,
    })

    const parsed = parseDreamResponse(response, ConsolidateResponseSchema)
    if (!parsed) return []

    // Step 4: Execute actions (sequential: MERGE deletes files that later actions may reference)
    for (const action of parsed.actions) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const op = await executeAction(action, contextTreeDir, fileContents)
        if (op) results.push(op)
      } catch {
        // Skip failed action, continue with others
      }
    }
  } catch {
    // Skip failed domain — return whatever succeeded
  } finally {
    await agent.deleteTaskSession(sessionId).catch(() => {})
  }

  return results
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), {recursive: true})
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

/** Max total chars for LLM sandbox payload — matches curate task cap (MAX_CONTENT_PER_FILE × MAX_FILES). */
const MAX_PAYLOAD_CHARS = 200_000

/**
 * Cap the total payload size by evicting non-changed files (lowest relevance) when the
 * combined content exceeds MAX_PAYLOAD_BYTES. Changed files are always kept.
 */
function capPayloadSize(payload: Record<string, string>, changedFiles: string[]): Record<string, string> {
  const changedSet = new Set(changedFiles)
  let totalSize = 0
  for (const content of Object.values(payload)) totalSize += content.length

  if (totalSize <= MAX_PAYLOAD_CHARS) return payload

  // Keep changed files, evict non-changed (siblings/search results) until under cap
  const result: Record<string, string> = {}
  let currentSize = 0

  // Add changed files first (always kept)
  for (const [path, content] of Object.entries(payload)) {
    if (changedSet.has(path)) {
      result[path] = content
      currentSize += content.length
    }
  }

  // Add non-changed files until cap reached
  for (const [path, content] of Object.entries(payload)) {
    if (!changedSet.has(path)) {
      if (currentSize + content.length > MAX_PAYLOAD_CHARS) continue
      result[path] = content
      currentSize += content.length
    }
  }

  return result
}

/** Merge extra fields into existing YAML frontmatter, or prepend new frontmatter if none exists. */
function addFrontmatterFields(content: string, fields: Record<string, unknown>): string {
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const endIndex = content.indexOf('\n---\n', 4)
    const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
    const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex

    if (actualEnd >= 0) {
      const yamlBlock = content.slice(4, actualEnd)
      const bodyStart = content.indexOf('\n', actualEnd + 1) + 1
      const body = content.slice(bodyStart)

      try {
        const parsed = yamlLoad(yamlBlock) as null | Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          const merged = {...parsed, ...fields}
          const newYaml = yamlDump(merged, {flowLevel: 2, lineWidth: -1, sortKeys: true}).trimEnd()
          return `---\n${newYaml}\n---\n${body}`
        }
      } catch {
        // YAML parse failure — prepend new frontmatter
      }
    }
  }

  // No valid frontmatter — prepend
  const yaml = yamlDump(fields, {flowLevel: 2, lineWidth: -1, sortKeys: true}).trimEnd()
  return `---\n${yaml}\n---\n${content}`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByDomain(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const domain = file.split('/')[0]
    const group = groups.get(domain) ?? []
    group.push(file)
    groups.set(domain, group)
  }

  return groups
}

async function loadFileAndRelated(
  file: string,
  domain: string,
  contextTreeDir: string,
  searchService: ConsolidateDeps['searchService'],
  fileContents: Map<string, string>,
  relatedPaths: Set<string>,
): Promise<void> {
  // Read changed file
  try {
    const content = await readFile(join(contextTreeDir, file), 'utf8')
    fileContents.set(file, content)
  } catch {
    return // File missing — skip
  }

  // BM25 search for related files in same domain
  try {
    const query = extractSearchQuery(file, fileContents.get(file) ?? '')
    const searchResults = await searchService.search(query, {limit: 5, scope: domain})
    const newPaths = searchResults.results
      .filter((r) => r.path !== file && !fileContents.has(r.path))
      .map((r) => r.path)

    for (const p of searchResults.results) {
      if (p.path !== file) relatedPaths.add(p.path)
    }

    const loaded = await Promise.all(
      newPaths.map(async (p) => {
        try {
          return {content: await readFile(join(contextTreeDir, p), 'utf8'), path: p}
        } catch {
          return null
        }
      }),
    )
    for (const item of loaded) {
      if (item) fileContents.set(item.path, item.content)
    }
  } catch {
    // Search failure — continue without related files
  }
}

async function loadSiblings(
  files: string[],
  contextTreeDir: string,
  fileContents: Map<string, string>,
): Promise<void> {
  const dirs = [...new Set(files.map((f) => dirname(f)))]

  const dirResults = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const entries = await readdir(join(contextTreeDir, dir), {withFileTypes: true})
        return entries
          .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_'))
          .map((e) => join(dir, e.name))
      } catch {
        return []
      }
    }),
  )

  const allSiblings = dirResults.flat().filter((s) => !fileContents.has(s))
  const loaded = await Promise.all(
    allSiblings.map(async (sibling) => {
      try {
        return {content: await readFile(join(contextTreeDir, sibling), 'utf8'), path: sibling}
      } catch {
        return null
      }
    }),
  )

  for (const item of loaded) {
    if (item) fileContents.set(item.path, item.content)
  }
}

function extractSearchQuery(filePath: string, content: string): string {
  // Use filename (without extension) + first 100 words of content
  const name = filePath.split('/').pop()?.replace(/\.md$/, '').replaceAll(/[-_]/g, ' ') ?? ''
  const words = content.split(/\s+/).slice(0, 100).join(' ')
  return `${name} ${words}`.trim()
}

function buildPrompt(changedFiles: string[], relatedFiles: string[], allFiles: string[]): string {
  return [
    'You are consolidating a knowledge context tree. The files have been loaded into __dream_consolidate_files (a JSON object mapping path → content).',
    '',
    `Changed files (recently curated): ${JSON.stringify(changedFiles)}`,
    `Related files (found via search): ${JSON.stringify(relatedFiles)}`,
    `All available files: ${JSON.stringify(allFiles)}`,
    '',
    'For each pair/group of related files, classify the relationship and recommend an action:',
    '- MERGE: Files are redundant/overlapping → combine into one, specify outputFile and mergedContent',
    '- TEMPORAL_UPDATE: File has contradictory/outdated info → rewrite with temporal narrative, specify updatedContent',
    '- CROSS_REFERENCE: Files are complementary → add cross-references (no content changes needed)',
    '- SKIP: Files are unrelated → no action needed',
    '',
    'Respond with JSON matching this schema:',
    '```',
    '{ "actions": [{ "type": "MERGE"|"TEMPORAL_UPDATE"|"CROSS_REFERENCE"|"SKIP", "files": ["path1", ...], "reason": "...", "confidence?": 0.0-1.0, "mergedContent?": "...", "outputFile?": "...", "updatedContent?": "..." }] }',
    '```',
    '',
    'Rules:',
    '- Only propose MERGE when files have significant overlap (>50% shared concepts)',
    '- For MERGE, choose the richer/more complete file as outputFile',
    '- For TEMPORAL_UPDATE, preserve all facts and add temporal context. Include confidence (0-1) indicating certainty that the update is correct',
    '- For CROSS_REFERENCE, just list the files — the system will add frontmatter links',
    '- Preserve all diagrams, tables, code examples, and structured data verbatim',
    '- Read file contents from __dream_consolidate_files via code_exec before making decisions',
  ].join('\n')
}

async function executeAction(
  action: ConsolidationAction,
  contextTreeDir: string,
  fileContents: Map<string, string>,
): Promise<DreamOperation | undefined> {
  switch (action.type) {
    case 'CROSS_REFERENCE': {
      return executeCrossReference(action, contextTreeDir, fileContents)
    }

    case 'MERGE': {
      return executeMerge(action, contextTreeDir, fileContents)
    }

    case 'SKIP': {
      return undefined
    }

    case 'TEMPORAL_UPDATE': {
      return executeTemporalUpdate(action, contextTreeDir, fileContents)
    }
  }
}

async function executeMerge(
  action: ConsolidationAction,
  contextTreeDir: string,
  fileContents: Map<string, string>,
): Promise<DreamOperation> {
  const outputFile = action.outputFile ?? action.files[0]
  if (!action.mergedContent) {
    throw new Error(`MERGE action missing mergedContent for ${outputFile}`)
  }

  const {mergedContent} = action

  // Capture previous texts
  const previousTexts: Record<string, string> = {}
  for (const file of action.files) {
    const content = fileContents.get(file)
    if (content !== undefined) {
      previousTexts[file] = content
    }
  }

  // Add consolidation metadata frontmatter, then write atomically
  const sourceFiles = action.files.filter((f) => f !== outputFile)
  /* eslint-disable camelcase */
  const consolidationFm = {
    consolidated_at: new Date().toISOString(),
    consolidated_from: sourceFiles.map((f) => ({date: new Date().toISOString(), path: f, reason: action.reason})),
  }
  /* eslint-enable camelcase */
  const contentWithFm = addFrontmatterFields(mergedContent, consolidationFm)
  await atomicWrite(join(contextTreeDir, outputFile), contentWithFm)

  // Delete source files (except output target)
  const toDelete = action.files.filter((f) => f !== outputFile)
  await Promise.all(toDelete.map((f) => unlink(join(contextTreeDir, f)).catch(() => {})))

  // Determine needsReview
  const needsReview = determineNeedsReview('MERGE', action.files, fileContents)

  return {
    action: 'MERGE',
    inputFiles: action.files,
    needsReview,
    outputFile,
    previousTexts,
    reason: action.reason,
    type: 'CONSOLIDATE',
  }
}

async function executeTemporalUpdate(
  action: ConsolidationAction,
  contextTreeDir: string,
  fileContents: Map<string, string>,
): Promise<DreamOperation> {
  const targetFile = action.files[0]
  if (!action.updatedContent) {
    throw new Error(`TEMPORAL_UPDATE action missing updatedContent for ${targetFile}`)
  }

  const {updatedContent} = action

  // Capture previous text
  const previousTexts: Record<string, string> = {}
  const original = fileContents.get(targetFile)
  if (original !== undefined) {
    previousTexts[targetFile] = original
  }

  // Add consolidation timestamp, then write atomically
  // eslint-disable-next-line camelcase
  const contentWithFm = addFrontmatterFields(updatedContent, {consolidated_at: new Date().toISOString()})
  await atomicWrite(join(contextTreeDir, targetFile), contentWithFm)

  const needsReview = determineNeedsReview('TEMPORAL_UPDATE', action.files, fileContents, action.confidence)

  return {
    action: 'TEMPORAL_UPDATE',
    inputFiles: action.files,
    needsReview,
    previousTexts,
    reason: action.reason,
    type: 'CONSOLIDATE',
  }
}

async function executeCrossReference(
  action: ConsolidationAction,
  contextTreeDir: string,
  fileContents: Map<string, string>,
): Promise<DreamOperation> {
  // For each file, add the other files to its related frontmatter
  await Promise.all(
    action.files.map((file) => {
      const otherFiles = action.files.filter((f) => f !== file)
      return addRelatedLinks(join(contextTreeDir, file), otherFiles)
    }),
  )

  const needsReview = determineNeedsReview('CROSS_REFERENCE', action.files, fileContents)

  return {
    action: 'CROSS_REFERENCE',
    inputFiles: action.files,
    needsReview,
    reason: action.reason,
    type: 'CONSOLIDATE',
  }
}

async function addRelatedLinks(filePath: string, relatedPaths: string[]): Promise<void> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    return // File missing — skip
  }

  // Parse existing frontmatter
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const endIndex = content.indexOf('\n---\n', 4)
    const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
    const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex

    if (actualEnd >= 0) {
      const yamlBlock = content.slice(4, actualEnd)
      const bodyStart = content.indexOf('\n', actualEnd + 1) + 1
      const body = content.slice(bodyStart)

      try {
        const parsed = yamlLoad(yamlBlock) as null | Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          const existing = Array.isArray(parsed.related) ? (parsed.related as string[]) : []
          parsed.related = [...new Set([...existing, ...relatedPaths])]
          const newYaml = yamlDump(parsed, {flowLevel: 1, lineWidth: -1, sortKeys: true}).trimEnd()
          await atomicWrite(filePath, `---\n${newYaml}\n---\n${body}`)
          return
        }
      } catch {
        // YAML parse failure — skip
      }
    }
  }

  // No existing frontmatter — add one with related field
  const yaml = yamlDump({related: relatedPaths}, {flowLevel: 1, lineWidth: -1, sortKeys: true}).trimEnd()
  await atomicWrite(filePath, `---\n${yaml}\n---\n${content}`)
}

function determineNeedsReview(
  actionType: 'CROSS_REFERENCE' | 'MERGE' | 'TEMPORAL_UPDATE',
  files: string[],
  fileContents: Map<string, string>,
  confidence?: number,
): boolean {
  // MERGE always needs review
  if (actionType === 'MERGE') return true

  // TEMPORAL_UPDATE: needs review when confidence is low or absent
  if (actionType === 'TEMPORAL_UPDATE') return (confidence ?? 0) < 0.7

  // CROSS_REFERENCE: only if any file has core maturity
  for (const file of files) {
    const content = fileContents.get(file)
    if (content) {
      const scoring = parseFrontmatterScoring(content)
      if (scoring?.maturity === 'core') return true
    }
  }

  return false
}
