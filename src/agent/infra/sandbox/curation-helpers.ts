/**
 * Curation REPL Library — Pre-built helpers for curation workflow.
 *
 * Injected into the sandbox as `tools.curation.*` so the LLM calls
 * these functions instead of generating identical infrastructure code
 * (chunking loops, metadata inspection, deduplication) every curation run.
 *
 * All functions operate on values passed in, not variable names.
 * - recon, chunk, detectMessageBoundaries, groupBySubject, dedup: stateless (no mutation, no I/O)
 * - recordProgress: intentionally mutating (pushes entry into history object)
 */

import {CURATION_CHAR_THRESHOLD} from '../../../shared/constants/curation.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Threshold below which chunking is skipped — derived from shared constant */
export const SINGLE_PASS_CHAR_THRESHOLD = CURATION_CHAR_THRESHOLD

/** Valid categories — mirrors CurateFact.category from i-curate-service.ts:51 */
export type CurationCategory = 'convention' | 'environment' | 'other' | 'personal' | 'preference' | 'project' | 'team'

export const VALID_CATEGORIES = new Set<string>([
  'convention', 'environment', 'other', 'personal', 'preference', 'project', 'team',
])

export interface CurationFact {
  category?: CurationCategory
  statement: string
  subject?: string
}

export interface ReconResult {
  headPreview: string
  history: {domains: Record<string, string[]>; totalProcessed: number}
  meta: {charCount: number; lineCount: number; messageCount: number}
  suggestedChunkCount: number
  suggestedMode: 'chunked' | 'single-pass'
  tailPreview: string
}

export interface ChunkResult {
  boundaries: Array<{end: number; start: number}>
  chunks: string[]
  totalChunks: number
}

export interface MessageBoundary {
  index: number
  offset: number
  role: string
}

// ---------------------------------------------------------------------------
// recon — combines Steps 0-2 into one call
// ---------------------------------------------------------------------------

export function recon(
  context: string,
  meta: Record<string, unknown>,
  history: Record<string, unknown>,
): ReconResult {
  const charCount = context.length
  const lines = context.split('\n')
  const lineCount = lines.length
  const messageCount = (context.match(/\n\n\[(USER|ASSISTANT)\]:/g) || []).length

  // Summarize history domains
  const histEntries = (history as {entries?: Array<{domain?: string; keyFacts?: string[]; title?: string}>}).entries ?? []
  const domains: Record<string, string[]> = {}
  for (const entry of histEntries) {
    const domain = entry.domain ?? 'unknown'
    if (!domains[domain]) {
      domains[domain] = []
    }

    if (entry.title) {
      domains[domain].push(entry.title)
    }
  }

  const totalProcessed = (history as {totalProcessed?: number}).totalProcessed ?? 0

  const suggestedChunkCount = Math.ceil(charCount / 8000)
  const suggestedMode: 'chunked' | 'single-pass' = charCount < SINGLE_PASS_CHAR_THRESHOLD ? 'single-pass' : 'chunked'

  return {
    headPreview: context.slice(0, 3000),
    history: {domains, totalProcessed},
    meta: {charCount, lineCount, messageCount},
    suggestedChunkCount,
    suggestedMode,
    tailPreview: context.slice(-1000),
  }
}

// ---------------------------------------------------------------------------
// chunk — intelligent boundary-aware text splitting
// ---------------------------------------------------------------------------

const CODE_FENCE_REGEX = /^```/

export function chunk(
  context: string,
  options?: {overlap?: number; size?: number},
): ChunkResult {
  const chunkSize = options?.size ?? 8000
  const overlap = options?.overlap ?? 200

  if (!context || context.length === 0) {
    return {boundaries: [], chunks: [], totalChunks: 0}
  }

  if (context.length <= chunkSize) {
    return {
      boundaries: [{end: context.length, start: 0}],
      chunks: [context],
      totalChunks: 1,
    }
  }

  const chunks: string[] = []
  const boundaries: Array<{end: number; start: number}> = []
  let offset = 0

  while (offset < context.length) {
    let end = Math.min(offset + chunkSize, context.length)

    // If not at the end of the string, try to find a good boundary
    if (end < context.length) {
      end = findChunkBoundary(context, offset, end)
    }

    chunks.push(context.slice(offset, end))
    boundaries.push({end, start: offset})

    // Advance with overlap (but never go backwards)
    const nextOffset = end - overlap
    offset = nextOffset > offset ? nextOffset : end

    // Safety: ensure we always advance (prevents infinite loops on pathological input)
    if (offset <= boundaries.at(-1)!.start) {
      offset = end
    }
  }

  return {boundaries, chunks, totalChunks: chunks.length}
}

/**
 * Find the best chunk boundary near `end` without going past `offset + maxSize`.
 * Priority: \n\n (paragraph) > [USER]:/[ASSISTANT]: marker > \n (line) > hard cut.
 * Never splits inside ``` code fences.
 */
function findChunkBoundary(context: string, offset: number, end: number): number {
  const searchStart = Math.max(offset + Math.floor((end - offset) * 0.5), offset)
  const region = context.slice(searchStart, end)

  // Check if we're inside a code fence and try to close it
  const fencesBefore = countCodeFences(context.slice(offset, end))
  if (fencesBefore % 2 !== 0) {
    // Inside a code fence — look for closing fence after end
    const closingFence = context.indexOf('```', end)
    if (closingFence !== -1 && closingFence - offset <= (end - offset) * 1.2) {
      // Extend to include closing fence + newline
      const afterFence = context.indexOf('\n', closingFence)

      return afterFence === -1 ? closingFence + 3 : afterFence + 1
    }
  }

  // Try paragraph boundary (\n\n)
  const paraBreak = region.lastIndexOf('\n\n')
  if (paraBreak !== -1) {
    return searchStart + paraBreak + 2
  }

  // Try message boundary ([USER]: or [ASSISTANT]:)
  const msgPattern = /\n\[(USER|ASSISTANT)\]:/g
  let lastMsgMatch: null | RegExpExecArray = null
  let match: null | RegExpExecArray = null
  while ((match = msgPattern.exec(region)) !== null) {
    lastMsgMatch = match
  }

  if (lastMsgMatch) {
    return searchStart + lastMsgMatch.index + 1
  }

  // Try line boundary (\n)
  const lineBreak = region.lastIndexOf('\n')
  if (lineBreak !== -1) {
    return searchStart + lineBreak + 1
  }

  // Hard cut — guarantees forward progress
  return end
}

function countCodeFences(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    if (CODE_FENCE_REGEX.test(line.trim())) {
      count++
    }
  }

  return count
}

// ---------------------------------------------------------------------------
// detectMessageBoundaries
// ---------------------------------------------------------------------------

const MESSAGE_BOUNDARY_REGEX = /\n\[(USER|ASSISTANT)\]:/g

export function detectMessageBoundaries(context: string): MessageBoundary[] {
  const results: MessageBoundary[] = []
  let match: null | RegExpExecArray = null
  let index = 0

  while ((match = MESSAGE_BOUNDARY_REGEX.exec(context)) !== null) {
    results.push({
      index: index++,
      offset: match.index + 1, // skip the leading \n
      role: match[1].toLowerCase(),
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// groupBySubject
// ---------------------------------------------------------------------------

export function groupBySubject(
  facts: CurationFact[],
): Record<string, CurationFact[]> {
  const groups: Record<string, CurationFact[]> = {}

  for (const fact of facts) {
    const key = fact.subject ?? fact.category ?? 'uncategorized'
    if (!groups[key]) {
      groups[key] = []
    }

    groups[key].push(fact)
  }

  return groups
}

// ---------------------------------------------------------------------------
// dedup — word-overlap Jaccard similarity
// ---------------------------------------------------------------------------

export function dedup(
  facts: CurationFact[],
  threshold = 0.85,
): CurationFact[] {
  if (facts.length <= 1) {
    return facts
  }

  const tokenized = facts.map((f) => tokenize(f.statement))
  const keep: boolean[] = Array.from({length: facts.length}, () => true)

  for (let i = 0; i < facts.length; i++) {
    if (!keep[i]) continue
    for (let j = i + 1; j < facts.length; j++) {
      if (!keep[j]) continue
      if (jaccardSimilarity(tokenized[i], tokenized[j]) >= threshold) {
        keep[j] = false
      }
    }
  }

  return facts.filter((_, i) => keep[i])
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }

  const union = a.size + b.size - intersection

  return union === 0 ? 0 : intersection / union
}

// ---------------------------------------------------------------------------
// recordProgress — intentionally mutating
// ---------------------------------------------------------------------------

export function recordProgress(
  history: Record<string, unknown>,
  entry: {domain: string; keyFacts: string[]; title: string},
): void {
  const entries = ((history as {entries?: unknown[]}).entries ?? []) as unknown[]
  entries.push(entry)
  ;(history as {entries: unknown[]}).entries = entries

  const current = ((history as {totalProcessed?: number}).totalProcessed ?? 0) as number
  ;(history as {totalProcessed: number}).totalProcessed = current + 1
}
