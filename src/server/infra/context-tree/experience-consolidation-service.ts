import type {IConsolidationLlm} from '../../core/interfaces/experience/i-consolidation-llm.js'
import type {ConsolidationQualityEvaluator} from './consolidation-quality.js'

import {MultiStrategyParser} from '../../../agent/infra/llm/parsing/multi-strategy-parser.js'
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

/** Parser for extracting string arrays from LLM consolidation responses. */
const bulletParser = new MultiStrategyParser<string[]>({
  enabledTiers: ['json-block', 'raw-json'],
  validator: (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string'),
})

/**
 * Parse LLM response into bullet strings.
 * Uses MultiStrategyParser with json-block and raw-json tiers,
 * then falls back to markdown bullet list extraction.
 */
function parseBullets(response: string): string[] {
  // Try structured parsing first
  const result = bulletParser.parse(response)
  if (result) {
    return result.parsed.filter((s) => s.trim().length > 0)
  }

  // Markdown bullet fallback
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

function readSectionLinesFromContent(content: string, section: string): string[] {
  const marker = `\n## ${section}\n`
  const start = content.indexOf(marker)
  if (start === -1) return []

  const sectionStart = start + marker.length
  const nextHeading = content.indexOf('\n## ', sectionStart)
  const sectionContent =
    nextHeading === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextHeading)

  return sectionContent
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
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
  private readonly qualityEvaluator?: ConsolidationQualityEvaluator

  constructor(llm: IConsolidationLlm, qualityEvaluator?: ConsolidationQualityEvaluator) {
    this.llm = llm
    this.qualityEvaluator = qualityEvaluator
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
    const content = await store.readFile(filename)
    const bullets = readSectionLinesFromContent(content, section)

    // Nothing meaningful to consolidate
    if (bullets.length < 2) {
      return
    }

    const scoring = parseFrontmatterScoring(content)

    // Missing frontmatter means corrupted file — skip rather than overwrite
    if (!scoring) {
      return
    }

    // Multi-round consolidation loop (Pattern 3)
    const originalBullets = [...bullets]
    let consolidated: null | string[] = null
    let previousScore: number | undefined
    const maxRounds = this.qualityEvaluator?.maxRounds ?? 1

    for (let round = 0; round < maxRounds; round++) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.llm.generate(
        CONSOLIDATION_SYSTEM_PROMPT,
        buildUserMessage(section, consolidated ?? bullets),
      )
      const result = parseBullets(response)

      // LLM returned nothing usable — stop loop to avoid data loss
      if (result.length === 0) {
        break
      }

      consolidated = result

      // Quality check (skip on last round or if no evaluator)
      if (this.qualityEvaluator) {
        const evaluation = this.qualityEvaluator.evaluate(originalBullets, consolidated)
        if (this.qualityEvaluator.shouldTerminate(evaluation.overallScore, previousScore, round + 1)) {
          break
        }

        previousScore = evaluation.overallScore
      } else {
        // Single-pass when no evaluator
        break
      }
    }

    // LLM returned nothing usable across all rounds — skip write
    if (!consolidated || consolidated.length === 0) {
      return
    }

    const finalScoring = recordConsolidation(scoring)
    const withUpdatedFrontmatter = updateScoringInContent(content, finalScoring)
    const withConsolidatedSection = replaceSectionContent(withUpdatedFrontmatter, section, consolidated)

    await store.writeFile(filename, withConsolidatedSection)
  }
}
