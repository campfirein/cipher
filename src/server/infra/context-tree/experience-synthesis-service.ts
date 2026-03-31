/* eslint-disable camelcase */
import type {ExperienceEntryFrontmatter, NormalizedPerformanceLogEntry} from '../../core/domain/experience/experience-types.js'
import type {IConsolidationLlm} from '../../core/interfaces/experience/i-consolidation-llm.js'

import {
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_REFLECTIONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
} from '../../constants.js'
import {buildEntryContent, computeContentHash, type ExperienceStore} from './experience-store.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM_PROMPT = `\
You are synthesizing experience entries for a knowledge-building system.
Write a cohesive synthesis of the provided entries. Free-form prose, not a bullet list.

Your synthesis should:
1. Identify the most important patterns across entries
2. Note contradictions or tensions between entries
3. Highlight what has been validated through repeated experience
4. Suggest what should be kept, deprecated, or needs more evidence
5. Reflect on performance correlation — which patterns associate with better task outcomes

Be concise but thorough.`

/** Max characters of entry content to include in the synthesis prompt. */
const MAX_CONTENT_CHARS = 15_000

// ---------------------------------------------------------------------------
// ExperienceSynthesisService
// ---------------------------------------------------------------------------

/**
 * Synthesizes accumulated experience entries into free-form reflection entries.
 *
 * Replaces the legacy ExperienceConsolidationService which deduplicated bullets.
 * This service creates new reflection entries in experience/reflections/
 * without deleting the original entries (HyperAgents archive pattern).
 */
export class ExperienceSynthesisService {
  private readonly llm: IConsolidationLlm

  constructor(llm: IConsolidationLlm) {
    this.llm = llm
  }

  /**
   * Synthesize experience entries into reflection entries.
   *
   * @param store - ExperienceStore instance for the current project
   * @param curationCount - Current curation count (used to determine strategy cadence)
   */
  async synthesize(store: ExperienceStore, curationCount: number): Promise<void> {
    const targets = [EXPERIENCE_LESSONS_DIR, EXPERIENCE_HINTS_DIR, EXPERIENCE_DEAD_ENDS_DIR]

    // Strategies synthesize less frequently — every INTERVAL * 3 curations
    if (curationCount > 0 && curationCount % (EXPERIENCE_CONSOLIDATION_INTERVAL * 3) === 0) {
      targets.push(EXPERIENCE_STRATEGIES_DIR)
    }

    // Read performance log for Ship 3 context injection
    let perfLog: NormalizedPerformanceLogEntry[] = []
    try {
      perfLog = await store.readPerformanceLog()
    } catch {
      // Fail-open: synthesis works without performance data
    }

    const results = await Promise.allSettled(
      targets.map((subfolder) => this.synthesizeSubfolder(store, subfolder, perfLog)),
    )

    // Only update watermark if at least one synthesis actually wrote a reflection.
    // synthesizeSubfolder returns true when a file was written, false for skips
    // (< 3 entries, empty LLM response), and rejects on errors.
    const anyWritten = results.some((r) => r.status === 'fulfilled' && r.value === true)
    if (anyWritten) {
      await store.writeMeta({lastConsolidatedAt: new Date().toISOString()}).catch(() => {})
    }
  }

  private async synthesizeSubfolder(store: ExperienceStore, subfolder: string, perfLog: NormalizedPerformanceLogEntry[] = []): Promise<boolean> {
    const entries = await store.listEntries(subfolder)

    // Nothing meaningful to synthesize
    if (entries.length < 3) {
      return false
    }

    // Read entries newest-first (date-prefixed filenames → reverse sort gives recency priority)
    const sortedEntries = [...entries].sort().reverse()
    const entryBodies: Array<{body: string; path: string; title: string}> = []
    let totalChars = 0

    for (const entry of sortedEntries) {
      if (totalChars >= MAX_CONTENT_CHARS) {
        break
      }

      // eslint-disable-next-line no-await-in-loop
      const content = await store.readEntry(subfolder, entry)
      const titleMatch = /title:\s*"([^"]*)"/.exec(content)
      const title = titleMatch?.[1] ?? entry.replace('.md', '')

      // Strip frontmatter to get body
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
      const body = bodyStart === -1 ? content : content.slice(bodyStart + 3).trim()

      entryBodies.push({body, path: `experience/${subfolder}/${entry}`, title})
      totalChars += body.length
    }

    // Build user message with entry content
    const entriesBlock = entryBodies
      .map((e) => `### ${e.title}\n${e.body}`)
      .join('\n\n')

    // Build performance context section (Ship 3)
    const perfContext = buildPerformanceContext(perfLog, subfolder, entryBodies.map((e) => e.path))

    const userMessage = `Below are individual experience entries from the "${subfolder}" category.\n\n${entriesBlock}${perfContext}\n\nWrite your synthesis:`

    // One-pass LLM call — no multi-round quality loop
    const response = await this.llm.generate(SYNTHESIS_SYSTEM_PROMPT, userMessage)

    if (!response || response.trim().length === 0) {
      return false
    }

    // Create/update reflection entry
    const iso = new Date().toISOString()
    const date = iso.slice(0, 10)
    const hash = computeContentHash(response)

    const frontmatter: ExperienceEntryFrontmatter = {
      contentHash: hash,
      createdAt: iso,
      derived_from: entryBodies.map((e) => e.path),
      importance: 60,
      maturity: 'validated',
      recency: 1,
      tags: ['experience', 'reflection', subfolder, 'synthesis'],
      title: `${subfolder} synthesis`,
      type: 'reflection',
      updatedAt: iso,
    }

    // Keep one synthesis snapshot per day/subfolder. Re-running on the same day
    // overwrites that day's file, while later days intentionally accumulate
    // versioned reflection entries for historical comparison.
    const filename = `${date}--${subfolder}-synthesis.md`
    const content = buildEntryContent(frontmatter, response)
    await store.writeEntry(EXPERIENCE_REFLECTIONS_DIR, filename, content)

    return true
  }
}

/**
 * Build a performance context section for the synthesis prompt.
 * Returns empty string when insufficient data (< 3 entries referencing this subfolder).
 */
function buildPerformanceContext(
  log: NormalizedPerformanceLogEntry[],
  subfolder: string,
  entryPaths: string[],
): string {
  if (log.length < 3) return ''

  // Filter log entries that reference paths in this subfolder
  const entryPathSet = new Set(entryPaths)
  const relevant = log.filter((e) =>
    e.insightsActive.some((p) => entryPathSet.has(p) || p.includes(`/${subfolder}/`)),
  )

  if (relevant.length < 3) return ''

  // Compute domain-level stats
  const scores = relevant.map((e) => e.score)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const mid = Math.floor(scores.length / 2)
  const firstHalf = scores.slice(0, mid)
  const secondHalf = scores.slice(mid)
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / (firstHalf.length || 1)
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / (secondHalf.length || 1)
  const diff = avgSecond - avgFirst
  const trend = diff > 0.05 ? 'trending up' : diff < -0.05 ? 'trending down' : 'stable'

  // Find entries that appear most in high/low scoring curations
  const domainAvg = avg
  const highEntries = new Map<string, number>()
  const lowEntries = new Map<string, number>()

  for (const entry of relevant) {
    const bucket = entry.score > domainAvg ? highEntries : lowEntries
    for (const path of entry.insightsActive) {
      if (entryPathSet.has(path) || path.includes(`/${subfolder}/`)) {
        bucket.set(path, (bucket.get(path) ?? 0) + 1)
      }
    }
  }

  const topHigh = [...highEntries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p.split('/').pop() ?? p)
  const topLow = [...lowEntries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p.split('/').pop() ?? p)

  const lines = [
    '',
    `## Performance Context`,
    `Recent curations referencing "${subfolder}" entries:`,
    `- Average score: ${avg.toFixed(2)} (${relevant.length} tasks), ${trend}`,
  ]

  if (topHigh.length > 0) {
    lines.push(`- Entries frequently active in high-scoring tasks: ${topHigh.join(', ')}`)
  }

  if (topLow.length > 0) {
    lines.push(`- Entries frequently active in lower-scoring tasks: ${topLow.join(', ')}`)
  }

  lines.push('Consider which patterns correlate with better task outcomes.')

  return '\n' + lines.join('\n')
}
