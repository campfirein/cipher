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
import {access, mkdir, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {ILogger} from '../../../../agent/core/interfaces/i-logger.js'
import type {DreamOperation} from '../dream-log-schema.js'
import type {ConsolidationAction} from '../dream-response-schemas.js'
import type {DreamState, PendingMerge} from '../dream-state-schema.js'

import {warnSidecarFailure} from '../../../core/domain/knowledge/sidecar-logging.js'
import {isExcludedFromSync} from '../../context-tree/derived-artifact.js'
import {ConsolidateResponseSchema} from '../dream-response-schemas.js'
import {parseDreamResponse} from '../parse-dream-response.js'

export type ConsolidateDeps = {
  agent: ICipherAgent
  contextTreeDir: string
  /**
   * Optional. When present, pendingMerges from prior dreams (written by prune's
   * SUGGEST_MERGE) are consumed at the start of consolidate: source files are
   * added to changedFiles, their target/reason is passed to the LLM as a hint,
   * and the pendingMerges list is cleared.
   */
  dreamStateService?: {
    read(): Promise<DreamState>
    update(updater: (state: DreamState) => DreamState): Promise<DreamState>
    write(state: DreamState): Promise<void>
  }
  /**
   * Optional logger. When provided, per-file sidecar failures during the
   * CROSS_REFERENCE review gate emit a warn so silent swallows are visible.
   */
  logger?: ILogger
  reviewBackupStore?: {
    save(relativePath: string, content: string): Promise<void>
  }
  /**
   * Optional. When present, the CROSS_REFERENCE review-gate consults the
   * sidecar to check whether any input file has `maturity === 'core'`. Absent
   * store or missing entries mean no file qualifies as core — review is
   * skipped, matching the pre-migration behaviour for paths without scoring.
   */
  runtimeSignalStore?: {
    get(relPath: string): Promise<{maturity: 'core' | 'draft' | 'validated'}>
  }
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
  // Cross-cycle: fold in pendingMerges written by the previous dream's Prune.
  // Source files (if still on disk) join the changedFiles set so consolidate
  // re-evaluates them; mergeTarget + reason surface to the LLM as a hint.
  // pendingMerges is cleared unconditionally after this pass — consumed
  // regardless of outcome, per notes/byterover-dream/6-dream-undo-and-cross-cycle.md.
  const hints = await loadAndClearPendingMerges(deps, changedFiles)

  if (changedFiles.length === 0) return []

  // Step 1: Group by domain
  const domainGroups = groupByDomain(changedFiles)

  // Step 2-5: Process each domain sequentially to avoid concurrent file writes
  const allResults: DreamOperation[] = []
  for (const [domain, files] of domainGroups) {
    if (deps.signal?.aborted) break
    // eslint-disable-next-line no-await-in-loop
    const domainOps = await processDomain(domain, files, deps, hints)
    allResults.push(...domainOps)
  }

  return allResults
}

/**
 * Reads pendingMerges from state, mutates `changedFiles` to include any
 * pending sourceFiles that still exist on disk, and clears the list.
 * Returns the list for use as LLM prompt hints (may be empty).
 *
 * Two-phase access pattern (intentional):
 *   1. unguarded `read()` to build hints — hints are non-binding LLM
 *      suggestions, so a slightly-stale snapshot here is acceptable. Avoids
 *      holding the per-file mutex across the file-existence checks below.
 *   2. mutex-guarded `update()` to clear pendingMerges — must be atomic so a
 *      concurrent `incrementCurationCount` isn't overwritten by writing back
 *      from a stale snapshot.
 *
 * If a concurrent prune appends new entries between the two phases, those new
 * entries are NOT cleared by this call — they remain for the next dream's
 * consolidate to consume. That's correct behavior.
 */
async function loadAndClearPendingMerges(
  deps: ConsolidateDeps,
  changedFiles: string[],
): Promise<PendingMerge[]> {
  if (!deps.dreamStateService) return []

  let state: DreamState
  try {
    state = await deps.dreamStateService.read()
  } catch {
    // If the state file is unreadable we can't safely build hints; the
    // matching `update()` below would also fail. Return early — the next
    // dream will retry once the file is readable again.
    return []
  }

  const pending = state.pendingMerges ?? []
  if (pending.length === 0) return []

  // Check all source files in parallel — independent fs stat calls.
  const presenceChecks = await Promise.all(
    pending.map((entry) => fileExists(join(deps.contextTreeDir, entry.sourceFile))),
  )

  const existing = new Set(changedFiles)
  const hints: PendingMerge[] = []
  for (const [index, entry] of pending.entries()) {
    if (!presenceChecks[index]) continue // Stale suggestion — skip silently
    hints.push(entry)
    if (!existing.has(entry.sourceFile)) {
      changedFiles.push(entry.sourceFile)
      existing.add(entry.sourceFile)
    }
  }

  try {
    // Clear pendingMerges under the per-file mutex so a concurrent
    // incrementCurationCount can't be lost by overwriting from a stale snapshot.
    // The updater spreads the latest state, preserving any field a parallel
    // writer just touched.
    await deps.dreamStateService.update((latest) => ({...latest, pendingMerges: []}))
  } catch {
    // Fail-open: failure to clear pendingMerges is a minor bookkeeping issue,
    // not a reason to block the dream.
  }

  return hints
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

async function processDomain(domain: string, files: string[], deps: ConsolidateDeps, hints: PendingMerge[] = []): Promise<DreamOperation[]> {
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

    const prompt = buildPrompt(files, [...relatedPaths], filesPayload, hints)
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
        const op = await executeAction(action, {
          contextTreeDir,
          fileContents,
          logger: deps.logger,
          reviewBackupStore: deps.reviewBackupStore,
          runtimeSignalStore: deps.runtimeSignalStore,
        })
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
          // Spread preserves existing key order; new fields are appended at end.
          const merged = {...parsed, ...fields}
          const newYaml = yamlDump(merged, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
          return `---\n${newYaml}\n---\n${body}`
        }
      } catch {
        // YAML parse failure — prepend new frontmatter
      }
    }
  }

  // No valid frontmatter — prepend
  const yaml = yamlDump(fields, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
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

function buildPrompt(
  changedFiles: string[],
  relatedFiles: string[],
  filesPayload: Record<string, string>,
  pendingMergeHints: PendingMerge[] = [],
): string {
  const allFiles = Object.keys(filesPayload)
  const marker = '━'.repeat(60)
  const fileBlocks = allFiles
    .map((path) => `\n${marker}\nPATH: ${path}\n${marker}\n${filesPayload[path]}`)
    .join('\n')

  const lines: string[] = [
    'You are consolidating a knowledge context tree. The full contents of every file are included below — read them directly, then classify relationships. Do NOT use code_exec.',
    '',
    `Changed files (recently curated): ${JSON.stringify(changedFiles)}`,
    `Related files (found via search): ${JSON.stringify(relatedFiles)}`,
    `All available files: ${JSON.stringify(allFiles)}`,
  ]

  // Surface prior-dream merge suggestions as non-binding hints. LLM may still classify SKIP.
  const relevantHints = pendingMergeHints.filter((h) => allFiles.includes(h.sourceFile) || allFiles.includes(h.mergeTarget))
  if (relevantHints.length > 0) {
    lines.push('', 'Note: A previous analysis suggested these files may be merge candidates:')
    for (const h of relevantHints) {
      lines.push(`- ${h.sourceFile} → merge into ${h.mergeTarget} (reason: ${h.reason})`)
    }

    lines.push('Consider these suggestions but make your own judgment.')
  }

  lines.push(
    '',
    'File contents:',
    fileBlocks,
    '',
    'For each pair/group of related files, classify the relationship and recommend an action:',
    '- MERGE: Files are redundant/overlapping → combine into one, specify outputFile and mergedContent',
    '- TEMPORAL_UPDATE: File has contradictory/outdated info → rewrite with temporal narrative, specify updatedContent',
    '- CROSS_REFERENCE: Files are complementary → add cross-references (no content changes needed)',
    '- SKIP: Files are genuinely unrelated → no action needed',
    '',
    'Respond with JSON matching this schema:',
    '```',
    '{ "actions": [{ "type": "MERGE"|"TEMPORAL_UPDATE"|"CROSS_REFERENCE"|"SKIP", "files": ["path1", ...], "reason": "...", "confidence?": 0.0-1.0, "mergedContent?": "...", "outputFile?": "...", "updatedContent?": "..." }] }',
    '```',
    '',
    'Rules:',
    '- Default to MERGE when files share >50% of content or cover the same topic. SKIP only when files are genuinely on unrelated topics.',
    '- Returning all SKIP when duplicates exist is a failure, not caution.',
    '- For MERGE, choose the richer/more complete file as outputFile. The mergedContent should preserve all unique details from both sources.',
    '- For TEMPORAL_UPDATE, preserve all facts and add temporal context. Include confidence (0-1) indicating certainty that the update is correct.',
    '- For CROSS_REFERENCE, just list the files — the system will add frontmatter links.',
    '- Preserve all diagrams, tables, code examples, and structured data verbatim.',
  )
  return lines.join('\n')
}

type ActionContext = {
  contextTreeDir: string
  fileContents: Map<string, string>
  logger?: ConsolidateDeps['logger']
  reviewBackupStore?: ConsolidateDeps['reviewBackupStore']
  runtimeSignalStore: ConsolidateDeps['runtimeSignalStore']
}

async function executeAction(
  action: ConsolidationAction,
  ctx: ActionContext,
): Promise<DreamOperation | undefined> {
  switch (action.type) {
    case 'CROSS_REFERENCE': {
      return executeCrossReference(action, ctx)
    }

    case 'MERGE': {
      return executeMerge(action, ctx)
    }

    case 'SKIP': {
      return undefined
    }

    case 'TEMPORAL_UPDATE': {
      return executeTemporalUpdate(action, ctx)
    }
  }
}

async function executeMerge(action: ConsolidationAction, ctx: ActionContext): Promise<DreamOperation> {
  const {contextTreeDir, fileContents, reviewBackupStore, runtimeSignalStore} = ctx
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

  // Create review backups before destructive writes (MERGE always needs review)
  if (reviewBackupStore) {
    await Promise.all(
      Object.entries(previousTexts).map(([file, content]) =>
        reviewBackupStore.save(file, content).catch(() => {}),
      ),
    )
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
  const needsReview = await determineNeedsReview('MERGE', action.files, {runtimeSignalStore})

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

async function executeTemporalUpdate(action: ConsolidationAction, ctx: ActionContext): Promise<DreamOperation> {
  const {contextTreeDir, fileContents, reviewBackupStore, runtimeSignalStore} = ctx
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

  const needsReview = await determineNeedsReview('TEMPORAL_UPDATE', action.files, {
    confidence: action.confidence,
    runtimeSignalStore,
  })

  // Create review backup only when the operation needs human review
  if (reviewBackupStore && original !== undefined && needsReview) {
    try {
      await reviewBackupStore.save(targetFile, original)
    } catch {
      // Best-effort: backup failure must not block update
    }
  }

  // Add consolidation timestamp, then write atomically
  // eslint-disable-next-line camelcase
  const contentWithFm = addFrontmatterFields(updatedContent, {consolidated_at: new Date().toISOString()})
  await atomicWrite(join(contextTreeDir, targetFile), contentWithFm)

  return {
    action: 'TEMPORAL_UPDATE',
    inputFiles: action.files,
    needsReview,
    previousTexts,
    reason: action.reason,
    type: 'CONSOLIDATE',
  }
}

async function executeCrossReference(action: ConsolidationAction, ctx: ActionContext): Promise<DreamOperation> {
  const {contextTreeDir, fileContents, logger, reviewBackupStore, runtimeSignalStore} = ctx
  const previousTexts: Record<string, string> = {}
  for (const file of action.files) {
    const content = fileContents.get(file)
    if (content !== undefined) {
      previousTexts[file] = content
    }
  }

  const needsReview = await determineNeedsReview('CROSS_REFERENCE', action.files, {logger, runtimeSignalStore})
  if (needsReview && reviewBackupStore) {
    await Promise.all(
      Object.entries(previousTexts).map(([file, content]) =>
        reviewBackupStore.save(file, content).catch(() => {}),
      ),
    )
  }

  // For each file, add the other files to its related frontmatter
  // Skip derived-artifact targets so we never write related: onto them.
  const eligibleFiles = action.files.filter((f) => !isExcludedFromSync(f))
  await Promise.all(
    eligibleFiles.map((file) => {
      const otherFiles = eligibleFiles.filter((f) => f !== file)
      return addRelatedLinks(join(contextTreeDir, file), otherFiles)
    }),
  )

  return {
    action: 'CROSS_REFERENCE',
    inputFiles: action.files,
    needsReview,
    previousTexts,
    reason: action.reason,
    type: 'CONSOLIDATE',
  }
}

async function addRelatedLinks(filePath: string, relatedPaths: string[]): Promise<void> {
  // Skip paths that won't be pushed — they'd be dangling refs on remote.
  const incoming = relatedPaths.filter((p) => !isExcludedFromSync(p))

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
          const hadRelated = Array.isArray(parsed.related)
          const existing = (Array.isArray(parsed.related) ? (parsed.related as string[]) : [])
            .filter((p) => !isExcludedFromSync(p))
          const merged = [...new Set([...existing, ...incoming])]
          // Don't introduce a related: [] key into a file that didn't have one.
          if (!hadRelated && merged.length === 0) return
          parsed.related = merged
          const newYaml = yamlDump(parsed, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
          await atomicWrite(filePath, `---\n${newYaml}\n---\n${body}`)
          return
        }
      } catch {
        // YAML parse failure — skip
      }
    }
  }

  // No existing frontmatter — add one with related field, unless filter left nothing to add.
  if (incoming.length === 0) return
  const yaml = yamlDump({related: incoming}, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
  await atomicWrite(filePath, `---\n${yaml}\n---\n${content}`)
}

async function determineNeedsReview(
  actionType: 'CROSS_REFERENCE' | 'MERGE' | 'TEMPORAL_UPDATE',
  files: string[],
  opts: {
    confidence?: number
    logger?: ConsolidateDeps['logger']
    runtimeSignalStore: ConsolidateDeps['runtimeSignalStore']
  },
): Promise<boolean> {
  // MERGE always needs review
  if (actionType === 'MERGE') return true

  // TEMPORAL_UPDATE: needs review when confidence is low or absent
  if (actionType === 'TEMPORAL_UPDATE') return (opts.confidence ?? 0) < 0.7

  // CROSS_REFERENCE: only if any file has core maturity in the sidecar.
  // Without a store, no file can qualify as core — review is skipped, which
  // matches the pre-migration default when no scoring was present.
  const {logger, runtimeSignalStore} = opts
  if (!runtimeSignalStore) return false
  for (const file of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const signals = await runtimeSignalStore.get(file)
      if (signals.maturity === 'core') return true
    } catch (error) {
      // Ignore per-file sidecar failures — continue checking remaining files.
      warnSidecarFailure(logger, 'consolidate', 'get', `${file} (CROSS_REFERENCE gate)`, error)
    }
  }

  return false
}
