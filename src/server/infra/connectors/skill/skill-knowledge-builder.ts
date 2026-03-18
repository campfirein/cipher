import {
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../../constants.js'
import {cleanExperienceBullets} from '../../context-tree/experience-bullet-cleaner.js'
import {EXPERIENCE_SECTIONS, type ExperienceStore} from '../../context-tree/experience-store.js'

// ---------------------------------------------------------------------------
// Marker constants
// ---------------------------------------------------------------------------

const MARKER_START = '<!-- brv:auto-knowledge:start -->'
const MARKER_END = '<!-- brv:auto-knowledge:end -->'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillExportData {
  deadEnds: string[]
  hints: string[]
  lessons: string[]
  meta: {curationCount: number}
  strategies: string[]
}

// ---------------------------------------------------------------------------
// SkillKnowledgeBuilder
// ---------------------------------------------------------------------------

/**
 * Pure rendering layer — reads experience bullets, cleans them,
 * and renders a markdown knowledge block.  No file writes.
 */
export class SkillKnowledgeBuilder {
  constructor(private readonly store: ExperienceStore) {}

  /**
   * Read all experience sections, clean, and render a knowledge block.
   *
   * @returns Rendered markdown block (without markers) or `''` if every section is empty.
   */
  async build(): Promise<string> {
    const [lessons, hints, deadEnds, strategies] = await Promise.all([
      this.readAndClean(EXPERIENCE_LESSONS_FILE, EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE]),
      this.readAndClean(EXPERIENCE_HINTS_FILE, EXPERIENCE_SECTIONS[EXPERIENCE_HINTS_FILE]),
      this.readAndClean(EXPERIENCE_DEAD_ENDS_FILE, EXPERIENCE_SECTIONS[EXPERIENCE_DEAD_ENDS_FILE]),
      this.readAndClean(EXPERIENCE_PLAYBOOK_FILE, EXPERIENCE_SECTIONS[EXPERIENCE_PLAYBOOK_FILE]),
    ])

    const totalBullets = lessons.length + hints.length + deadEnds.length + strategies.length
    if (totalBullets === 0) {
      return ''
    }

    const meta = await this.store.readMeta()

    return this.renderBlock({
      deadEnds,
      hints,
      lessons,
      meta: {curationCount: meta.curationCount},
      strategies,
    })
  }

  /**
   * Splice a generated knowledge block into existing SKILL.md content.
   *
   * - If markers exist, replaces the content between them.
   * - If markers are absent and `block` is non-empty, appends markers + block.
   * - If `block` is empty and markers exist, removes markers + content (cleanup).
   * - If `block` is empty and markers are absent, returns content unchanged.
   */
  spliceIntoContent(existingContent: string, block: string): string {
    const startIdx = existingContent.indexOf(MARKER_START)
    const endIdx = existingContent.indexOf(MARKER_END)
    const hasMarkers = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx

    if (block.length === 0) {
      // Cleanup: remove markers + block
      if (!hasMarkers) {
        return existingContent
      }

      // Remove from the separator (---) before the marker through the end marker + trailing newline
      const before = this.trimTrailingSeparator(existingContent.slice(0, startIdx))
      const after = existingContent.slice(endIdx + MARKER_END.length).replace(/^\n/, '')

      return (before + after).trimEnd() + '\n'
    }

    const wrappedBlock = `${MARKER_START}\n${block}\n${MARKER_END}`

    if (hasMarkers) {
      // Replace existing block
      const before = existingContent.slice(0, startIdx)
      const after = existingContent.slice(endIdx + MARKER_END.length)

      return before + wrappedBlock + after
    }

    // Append with separator
    return `${existingContent.trimEnd()}\n\n---\n\n${wrappedBlock}\n`
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async readAndClean(filename: string, section: string): Promise<string[]> {
    const bullets = await this.store.readSectionLines(filename, section)

    return cleanExperienceBullets(bullets)
  }

  private renderBlock(data: SkillExportData): string {
    const lines: string[] = [
      '## Project Knowledge (Auto-Updated)',
      '',
      `> Auto-generated from ${data.meta.curationCount} curations. Use \`brv query\` for deeper exploration.`,
    ]

    if (data.lessons.length > 0) {
      lines.push('', '### Lessons Learned', ...data.lessons.map((b) => `- ${b}`))
    }

    if (data.hints.length > 0) {
      lines.push('', '### Hints & Tips', ...data.hints.map((b) => `- ${b}`))
    }

    if (data.deadEnds.length > 0) {
      lines.push('', '### Dead Ends (Avoid These)', ...data.deadEnds.map((b) => `- ${b}`))
    }

    if (data.strategies.length > 0) {
      lines.push('', '### Strategies', ...data.strategies.map((b) => `- ${b}`))
    }

    return lines.join('\n')
  }

  /**
   * Remove a trailing `---` separator and surrounding whitespace
   * so cleanup doesn't leave a dangling horizontal rule.
   */
  private trimTrailingSeparator(text: string): string {
    return text.replace(/\n*---\n*$/, '')
  }
}
