/**
 * Prune operation — identifies and archives stale/low-value context tree files.
 *
 * Flow:
 * 1. Find candidates via two signals:
 *    A) Archive service importance decay (draft files with importance < 35)
 *    B) Mtime staleness (draft: 60 days, validated: 120 days, core: never)
 * 2. Merge + dedup candidates, cap at 20 (stalest first)
 * 3. Single LLM call to review candidates (ARCHIVE / KEEP / MERGE_INTO)
 * 4. Execute decisions: archive, bump mtime, or defer merge
 *
 * Never throws — returns empty array on errors.
 */

import {readdir, readFile, stat, utimes} from 'node:fs/promises'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../dream-log-schema.js'
import type {PruneDecision} from '../dream-response-schemas.js'
import type {DreamState} from '../dream-state-schema.js'

import {isExcludedFromSync} from '../../context-tree/derived-artifact.js'
import {toUnixPath} from '../../context-tree/path-utils.js'
import {PruneResponseSchema} from '../dream-response-schemas.js'
import {parseDreamResponse} from '../parse-dream-response.js'

export type PruneDeps = {
  agent: ICipherAgent
  archiveService: {
    archiveEntry(relativePath: string, agent: ICipherAgent, directory?: string): Promise<{fullPath: string; originalPath: string; stubPath: string}>
    findArchiveCandidates(directory?: string): Promise<string[]>
  }
  contextTreeDir: string
  dreamLogId: string
  dreamStateService: {
    read(): Promise<DreamState>
    write(state: DreamState): Promise<void>
  }
  projectRoot: string
  reviewBackupStore?: {
    save(relativePath: string, content: string): Promise<void>
  }
  signal?: AbortSignal
  taskId: string
}

type CandidateInfo = {
  daysSinceModified: number
  importance: number
  maturity: string
  path: string
  signal: 'both' | 'importance' | 'mtime'
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_CANDIDATES = 20
const DRAFT_STALE_DAYS = 60
const VALIDATED_STALE_DAYS = 120

/**
 * Run pruning on the context tree.
 * Returns DreamOperation results (never throws).
 */
export async function prune(deps: PruneDeps): Promise<DreamOperation[]> {
  if (deps.signal?.aborted) return []

  try {
    // Step 1: Find candidates from both signals
    const candidates = await findCandidates(deps)
    if (candidates.length === 0) return []

    // Step 2: LLM review
    const decisions = await llmReview(candidates, deps)
    if (decisions.length === 0) return []

    // Step 3: Execute decisions
    return await executeDecisions(decisions, candidates, deps)
  } catch {
    return []
  }
}

// ── Step 1: Find candidates ────────────────────────────────────────────────

async function findCandidates(deps: PruneDeps): Promise<CandidateInfo[]> {
  const candidateMap = new Map<string, CandidateInfo>()
  const now = Date.now()

  // Signal A: archive service importance decay
  try {
    const importancePaths = await deps.archiveService.findArchiveCandidates(deps.projectRoot)
    const infoResults = await Promise.all(
      importancePaths.map(async (path) => ({info: await readCandidateInfo(deps.contextTreeDir, path, now), path})),
    )
    for (const {info, path} of infoResults) {
      if (info && info.maturity !== 'core') {
        candidateMap.set(path, {...info, signal: 'importance'})
      }
    }
  } catch {
    // Archive service failure — continue with Signal B only
  }

  // Signal B: mtime staleness
  try {
    const stalePaths = await findStaleFiles(deps.contextTreeDir, now)
    for (const {info, path} of stalePaths) {
      if (candidateMap.has(path)) {
        // Already found by Signal A — mark as both
        const existing = candidateMap.get(path)
        if (existing) candidateMap.set(path, {...existing, signal: 'both'})
      } else {
        candidateMap.set(path, {...info, signal: 'mtime'})
      }
    }
  } catch {
    // Walk failure — continue with whatever Signal A found
  }

  // Cap at 20, stalest first
  const candidates = [...candidateMap.values()]
  candidates.sort((a, b) => b.daysSinceModified - a.daysSinceModified)
  return candidates.slice(0, MAX_CANDIDATES)
}

async function readCandidateInfo(contextTreeDir: string, relativePath: string, now: number): Promise<CandidateInfo | undefined> {
  try {
    const fullPath = join(contextTreeDir, relativePath)
    const content = await readFile(fullPath, 'utf8')
    const fileStat = await stat(fullPath)
    const daysSinceModified = (now - fileStat.mtimeMs) / MS_PER_DAY

    return {
      daysSinceModified,
      importance: extractImportance(content),
      maturity: extractMaturity(content),
      path: relativePath,
      signal: 'importance',
    }
  } catch {
    return undefined
  }
}

async function findStaleFiles(contextTreeDir: string, now: number): Promise<Array<{info: CandidateInfo; path: string}>> {
  const results: Array<{info: CandidateInfo; path: string}> = []

  await walkMdFiles(contextTreeDir, async (relativePath, fullPath) => {
    try {
      const content = await readFile(fullPath, 'utf8')
      const maturity = extractMaturity(content)

      // core files NEVER pruned
      if (maturity === 'core') return

      const threshold = maturity === 'validated' ? VALIDATED_STALE_DAYS : DRAFT_STALE_DAYS
      const fileStat = await stat(fullPath)
      const daysSinceModified = (now - fileStat.mtimeMs) / MS_PER_DAY

      if (daysSinceModified >= threshold) {
        results.push({
          info: {
            daysSinceModified,
            importance: extractImportance(content),
            maturity,
            path: relativePath,
            signal: 'mtime',
          },
          path: relativePath,
        })
      }
    } catch {
      // Skip unreadable files
    }
  })

  return results
}

/** Walk active .md files in the context tree, skipping _/. dirs, _ prefixed files, and derived artifacts. */
async function walkMdFiles(
  contextTreeDir: string,
  callback: (relativePath: string, fullPath: string) => Promise<void>,
): Promise<void> {
  async function walk(currentDir: string): Promise<void> {
    let entries: Array<{isDirectory(): boolean; isFile(): boolean; name: string}>
    try {
      entries = (await readdir(currentDir, {withFileTypes: true})).map((e) => ({
        isDirectory: () => e.isDirectory(),
        isFile: () => e.isFile(),
        name: String(e.name),
      }))
    } catch {
      return
    }

    /* eslint-disable no-await-in-loop */
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
        await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        const relativePath = toUnixPath(fullPath.slice(contextTreeDir.length + 1))
        if (isExcludedFromSync(relativePath)) continue
        await callback(relativePath, fullPath)
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  await walk(contextTreeDir)
}

// ── Step 2: LLM review ────────────────────────────────────────────────────

async function llmReview(candidates: CandidateInfo[], deps: PruneDeps): Promise<PruneDecision[]> {
  const {agent, signal, taskId} = deps

  let sessionId: string
  try {
    sessionId = await agent.createTaskSession(taskId, 'dream-prune')
  } catch {
    return []
  }

  try {
    // Build candidate payload (content preview inlined directly in the prompt)
    const payload = await buildCandidatePayload(candidates, deps.contextTreeDir)

    const totalFileCount = await countActiveFiles(deps.contextTreeDir)
    const prompt = buildPrompt(candidates.length, totalFileCount, payload)

    const response = await agent.executeOnSession(sessionId, prompt, {
      executionContext: {commandType: 'curate', maxIterations: 10},
      signal,
      taskId,
    })

    const parsed = parseDreamResponse(response, PruneResponseSchema)
    return parsed?.decisions ?? []
  } catch {
    return []
  } finally {
    await agent.deleteTaskSession(sessionId).catch(() => {})
  }
}

async function buildCandidatePayload(
  candidates: CandidateInfo[],
  contextTreeDir: string,
): Promise<Array<{contentPreview: string; daysSinceModified: number; importance: number; maturity: string; path: string; signal: string}>> {
  return Promise.all(
    candidates.map(async (c) => {
      let contentPreview = ''
      try {
        const content = await readFile(join(contextTreeDir, c.path), 'utf8')
        contentPreview = content.slice(0, 1000)
      } catch {
        // Skip
      }

      return {
        contentPreview,
        daysSinceModified: Math.round(c.daysSinceModified),
        importance: c.importance,
        maturity: c.maturity,
        path: c.path,
        signal: c.signal,
      }
    }),
  )
}

async function countActiveFiles(contextTreeDir: string): Promise<number> {
  let count = 0
  await walkMdFiles(contextTreeDir, async () => { count++ })
  return count
}

function buildPrompt(
  candidateCount: number,
  totalFileCount: number,
  payload: Array<{contentPreview: string; daysSinceModified: number; importance: number; maturity: string; path: string; signal: string}>,
): string {
  const marker = '━'.repeat(60)
  const candidateBlocks = payload.map((c) =>
    `\n${marker}\nPATH: ${c.path}\nmaturity: ${c.maturity} | ${c.daysSinceModified}d old | importance: ${c.importance} | signal: ${c.signal}\n${marker}\n${c.contentPreview}`,
  )

  return [
    'You are reviewing files in a knowledge base for potential archival.',
    'These files were flagged as potentially stale or low-value based on metadata signals.',
    '',
    'For each file, decide:',
    '- ARCHIVE: File content is a placeholder, TODO, explicitly superseded, or has no actionable information.',
    '- KEEP: File has real, actionable knowledge even if older.',
    '- MERGE_INTO: Content clearly belongs in another specific file.',
    '',
    'Rules:',
    '- A draft file with importance < 35 whose body is a placeholder/TODO/"safe to delete" SHOULD be archived.',
    '- If the body explicitly says the content is obsolete, superseded, or never-filled-in, ARCHIVE.',
    '- Default to KEEP only when content is useful but stale, not when content is genuinely worthless.',
    '- MERGE_INTO should only be used when the content clearly belongs in another specific file that you can name.',
    '',
    'Context:',
    `- The context tree currently contains ${totalFileCount} active files.`,
    `- These ${candidateCount} files were flagged by staleness detection.`,
    '',
    'Candidates (full previews below):',
    ...candidateBlocks,
    '',
    'Respond IMMEDIATELY with JSON — do NOT use code_exec:',
    '```',
    '{ "decisions": [{ "file": "...", "decision": "ARCHIVE|KEEP|MERGE_INTO", "reason": "...", "mergeTarget": "path (only for MERGE_INTO)" }] }',
    '```',
  ].join('\n')
}

// ── Step 3: Execute decisions ──────────────────────────────────────────────

async function executeDecisions(
  decisions: PruneDecision[],
  candidates: CandidateInfo[],
  deps: PruneDeps,
): Promise<DreamOperation[]> {
  const candidateSet = new Set(candidates.map((c) => c.path))
  const results: DreamOperation[] = []

  for (const decision of decisions) {
    // Skip hallucinated paths — only process decisions for actual candidates
    if (!candidateSet.has(decision.file)) continue

    try {
      // eslint-disable-next-line no-await-in-loop
      const op = await executeDecision(decision, deps)
      if (op) results.push(op)
    } catch {
      // Skip failed decision — continue with others
    }
  }

  return results
}

async function executeDecision(decision: PruneDecision, deps: PruneDeps): Promise<DreamOperation | undefined> {
  switch (decision.decision) {
    case 'ARCHIVE': {
      // Create review backup before destructive archive (read content → save to review-backups/)
      if (deps.reviewBackupStore) {
        try {
          const content = await readFile(join(deps.contextTreeDir, decision.file), 'utf8')
          await deps.reviewBackupStore.save(decision.file, content)
        } catch {
          // Best-effort: backup failure must not block archive
        }
      }

      const archiveResult = await deps.archiveService.archiveEntry(decision.file, deps.agent, deps.projectRoot)
      return {
        action: 'ARCHIVE',
        file: decision.file,
        needsReview: true,
        reason: decision.reason,
        stubPath: archiveResult.stubPath,
        type: 'PRUNE',
      }
    }

    case 'KEEP': {
      // Bump mtime to reset staleness clock
      const absPath = join(deps.contextTreeDir, decision.file)
      const now = new Date()
      await utimes(absPath, now, now).catch(() => {})
      return {
        action: 'KEEP',
        file: decision.file,
        needsReview: false,
        reason: decision.reason,
        type: 'PRUNE',
      }
    }

    case 'MERGE_INTO': {
      if (!decision.mergeTarget) return undefined

      await writePendingMerge(decision, deps)
      return {
        action: 'SUGGEST_MERGE',
        file: decision.file,
        mergeTarget: decision.mergeTarget,
        needsReview: false,
        reason: decision.reason,
        type: 'PRUNE',
      }
    }

    default: {
      return undefined
    }
  }
}

async function writePendingMerge(decision: PruneDecision, deps: PruneDeps): Promise<void> {
  if (!decision.mergeTarget) return

  const dreamState = await deps.dreamStateService.read()
  const pendingMerges = dreamState.pendingMerges ?? []

  // Dedup check
  const alreadySuggested = pendingMerges.some(
    (m) => m.sourceFile === decision.file && m.mergeTarget === decision.mergeTarget,
  )
  if (alreadySuggested) return

  pendingMerges.push({
    mergeTarget: decision.mergeTarget,
    reason: decision.reason,
    sourceFile: decision.file,
    suggestedByDreamId: deps.dreamLogId,
  })

  await deps.dreamStateService.write({...dreamState, pendingMerges})
}

// ── Frontmatter helpers ────────────────────────────────────────────────────

function extractMaturity(content: string): string {
  const match = /^maturity:\s*['"]?(core|draft|validated)['"]?/m.exec(content)
  return match?.[1] ?? 'draft'
}

function extractImportance(content: string): number {
  const match = /^importance:\s*(\d+(?:\.\d+)?)/m.exec(content)
  return match ? Number.parseFloat(match[1]) : 50
}
