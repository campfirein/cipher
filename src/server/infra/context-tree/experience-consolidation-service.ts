import type {IConsolidationLlm} from '../../core/interfaces/experience/i-consolidation-llm.js'

import {
  EXPERIENCE_CONSOLIDATION_INTERVAL,
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../constants.js'
import {parseFrontmatterScoring, updateScoringInContent} from '../../core/domain/knowledge/markdown-writer.js'
import {recordConsolidation} from '../../core/domain/knowledge/memory-scoring.js'
import {EXPERIENCE_SECTIONS, type ExperienceStore} from './experience-store.js'

// ---------------------------------------------------------------------------
// Prompt constants
// ---------------------------------------------------------------------------

const CONSOLIDATION_SYSTEM_PROMPT = `\
You are a knowledge consolidation assistant for a software engineering tool.
Your sole task is to deduplicate and refine a list of knowledge bullets.
Return ONLY a valid JSON array of strings — no markdown, no explanation, no other text.`

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Build the user-facing consolidation prompt for a given section. */
function buildUserMessage(section: string, bullets: string[]): string {
  const bulletBlock = bullets.map((b) => `- ${b}`).join('\n')
  return `Consolidate the following "${section}" knowledge bullets.

Rules:
1. Remove exact duplicates and near-duplicates (keep the clearest phrasing).
2. Refine each entry to be concise and actionable.
3. Keep the most useful entries (max 20).

Input:
${bulletBlock}

Return ONLY a JSON array of strings (the refined bullet texts):`
}

/**
 * Parse LLM response into bullet strings.
 * Tries JSON array first; falls back to markdown bullet list.
 */
function parseBullets(response: string): string[] {
  try {
    const jsonMatch = /\[[\s\S]*\]/.exec(response)
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    }
  } catch {
    // JSON parse failed — fall through to markdown fallback
  }

  return response
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((text) => text.length > 0)
}

/**
 * Replace the content of a named section with a new set of bullets.
 * Preserves everything before the section header and after the next heading.
 * Returns the original content unchanged if the section header is not found.
 */
function replaceSectionContent(content: string, section: string, bullets: string[]): string {
  const marker = `\n## ${section}\n`
  const sectionStart = content.indexOf(marker)
  if (sectionStart === -1) return content

  const bodyStart = sectionStart + marker.length
  const nextHeading = content.indexOf('\n## ', bodyStart)
  const after = nextHeading === -1 ? '' : content.slice(nextHeading)
  const bulletBlock = bullets.map((b) => `- ${b}`).join('\n') + '\n'

  return content.slice(0, bodyStart) + bulletBlock + after
}

// ---------------------------------------------------------------------------
// ExperienceConsolidationService
// ---------------------------------------------------------------------------

/**
 * Periodically deduplicate and refine accumulated experience signals via LLM.
 *
 * Triggered every EXPERIENCE_CONSOLIDATION_INTERVAL curations for lessons,
 * hints, and dead-ends; every INTERVAL × 3 curations for the playbook
 * (strategic content changes less frequently).
 *
 * Fail-open: per-file errors are swallowed so a single bad LLM response
 * never blocks the remaining files or surfaces to the curation caller.
 */
export class ExperienceConsolidationService {
  private readonly llm: IConsolidationLlm

  constructor(llm: IConsolidationLlm) {
    this.llm = llm
  }

  /**
   * Consolidate experience files using the provided store and curation count.
   *
   * @param store - ExperienceStore instance for the current project
   * @param curationCount - Current curation count (used to determine playbook cadence)
   */
  async consolidate(store: ExperienceStore, curationCount: number): Promise<void> {
    const targets: Array<{filename: string; section: string}> = [
      {filename: EXPERIENCE_LESSONS_FILE, section: EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE]},
      {filename: EXPERIENCE_HINTS_FILE, section: EXPERIENCE_SECTIONS[EXPERIENCE_HINTS_FILE]},
      {filename: EXPERIENCE_DEAD_ENDS_FILE, section: EXPERIENCE_SECTIONS[EXPERIENCE_DEAD_ENDS_FILE]},
    ]

    // Playbook consolidates less frequently — every INTERVAL * 3 curations
    // (guard ensures curationCount=0 never triggers a playbook pass).
    if (curationCount > 0 && curationCount % (EXPERIENCE_CONSOLIDATION_INTERVAL * 3) === 0) {
      targets.push({filename: EXPERIENCE_PLAYBOOK_FILE, section: EXPERIENCE_SECTIONS[EXPERIENCE_PLAYBOOK_FILE]})
    }

    await Promise.all(
      targets.map(({filename, section}) =>
        this.consolidateFile(store, filename, section).catch(() => {
          // Best-effort — swallow per-file errors
        }),
      ),
    )

    // Update lastConsolidatedAt — best-effort
    await store.writeMeta({lastConsolidatedAt: new Date().toISOString()}).catch(() => {})
  }

  private async consolidateFile(store: ExperienceStore, filename: string, section: string): Promise<void> {
    const bullets = await store.readSectionLines(filename, section)

    // Nothing meaningful to consolidate
    if (bullets.length < 2) return

    const response = await this.llm.generate(CONSOLIDATION_SYSTEM_PROMPT, buildUserMessage(section, bullets))
    const consolidated = parseBullets(response)

    // LLM returned nothing usable — skip write to avoid data loss
    if (consolidated.length === 0) return

    const content = await store.readFile(filename)
    const scoring = parseFrontmatterScoring(content)

    // Missing frontmatter means corrupted file — skip rather than overwrite
    if (!scoring) return

    const finalScoring = recordConsolidation(scoring)

    const withUpdatedFrontmatter = updateScoringInContent(content, finalScoring)
    const withConsolidatedSection = replaceSectionContent(withUpdatedFrontmatter, section, consolidated)

    await store.writeFile(filename, withConsolidatedSection)
  }
}
