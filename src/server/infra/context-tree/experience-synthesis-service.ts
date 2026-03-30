/* eslint-disable camelcase */
import type {ExperienceEntryFrontmatter} from '../../core/domain/experience/experience-types.js'
import type {IConsolidationLlm} from '../../core/interfaces/experience/i-consolidation-llm.js'

import {
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
} from '../../constants.js'
import {applyDefaultScoring} from '../../core/domain/knowledge/memory-scoring.js'
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

    const results = await Promise.allSettled(
      targets.map((subfolder) => this.synthesizeSubfolder(store, subfolder)),
    )

    // Only update watermark if at least one synthesis actually wrote a reflection.
    // synthesizeSubfolder returns true when a file was written, false for skips
    // (< 3 entries, empty LLM response), and rejects on errors.
    const anyWritten = results.some((r) => r.status === 'fulfilled' && r.value === true)
    if (anyWritten) {
      await store.writeMeta({lastConsolidatedAt: new Date().toISOString()}).catch(() => {})
    }
  }

  private async synthesizeSubfolder(store: ExperienceStore, subfolder: string): Promise<boolean> {
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

    const userMessage = `Below are individual experience entries from the "${subfolder}" category.\n\n${entriesBlock}\n\nWrite your synthesis:`

    // One-pass LLM call — no multi-round quality loop
    const response = await this.llm.generate(SYNTHESIS_SYSTEM_PROMPT, userMessage)

    if (!response || response.trim().length === 0) {
      return false
    }

    // Create/update reflection entry
    const iso = new Date().toISOString()
    const date = iso.slice(0, 10)
    const scoring = applyDefaultScoring()
    const hash = computeContentHash(response)

    const frontmatter: ExperienceEntryFrontmatter = {
      contentHash: hash,
      createdAt: iso,
      derived_from: entryBodies.map((e) => e.path),
      importance: scoring.importance ?? 60,
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
    await store.writeEntry('reflections', filename, content)

    return true
  }
}
