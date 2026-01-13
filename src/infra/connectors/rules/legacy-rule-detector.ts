import type {Agent} from '../../../core/domain/entities/agent.js'
import type {
  ILegacyRuleDetector,
  LegacyRuleDetectionResult,
  LegacyRuleMatch,
  UncertainMatch,
} from '../../../core/interfaces/i-legacy-rule-detector.js'

import {BRV_RULE_TAG} from '../shared/constants.js'

export class LegacyRuleDetector implements ILegacyRuleDetector {
  private static readonly SECTION_SEPARATOR_PATTERN = /^---\s*$/
  private static readonly WORKFLOW_HEADER_PATTERN = /^#\sWorkflow Instruction$/

  public detectLegacyRules(content: string, agentName: Agent): LegacyRuleDetectionResult {
    // Normalize line endings to handle CRLF
    const normalizedContent = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    const lines = normalizedContent.split('\n')
    const footerTag = `${BRV_RULE_TAG} ${agentName}`
    const reliableMatches: LegacyRuleMatch[] = []
    const uncertainMatches: UncertainMatch[] = []
    const usedLineRanges: {end: number; start: number}[] = []
    // Find all occurrences of the footer tag
    for (const [index, line] of lines.entries()) {
      // Use exact match to avoid matching partial agent names like "Github Copilot Extended"
      if (line.trim() === footerTag) {
        const footerIndex = index
        const footerLineNumber = footerIndex + 1
        // Try to find the start of this ByteRover section
        const startIndex = this.findSectionStart(lines, footerIndex, usedLineRanges)
        if (startIndex === undefined) {
          // Uncertain match - couldn't reliably determine start
          uncertainMatches.push({
            footerLine: footerLineNumber,
            reason: 'Could not reliably determine the start of the ByteRover rule section.',
          })
        } else {
          // Reliable match found
          const startLineNumber = startIndex + 1
          const sectionContent = lines.slice(startIndex, footerIndex + 1).join('\n')
          reliableMatches.push({
            content: sectionContent,
            endLine: footerLineNumber,
            startLine: startLineNumber,
          })
          // Mark this range as used so it won't be reused by subsequent footers
          usedLineRanges.push({end: footerIndex, start: startIndex})
        }
      }
    }

    return {reliableMatches, uncertainMatches}
  }

  /**
   * Attempts to find the start of a ByteRover rule section by working backwards from the footer.
   *
   * Strategy 3 (Conservative Multi-Pattern Match):
   * 1. Look backwards for "# Workflow Instruction" header (most reliable)
   * 2. If not found, look backwards for "---" separator before command reference
   * 3. If still not found, return undefined (uncertain)
   *
   * @param lines All lines in the file.
   * @param footerIndex Index of the line containing the footer tag (0-indexed).
   * @param usedLineRanges Line ranges already claimed by detected sections.
   * @returns Index of the start line (0-indexed), or undefined if uncertain.
   */
  private findSectionStart(
    lines: string[],
    footerIndex: number,
    usedLineRanges: {end: number; start: number}[],
  ): number | undefined {
    // Strategy 1: Look for "# Workflow Instruction" header (most reliable)
    for (let i = footerIndex - 1; i >= 0; i--) {
      if (LegacyRuleDetector.WORKFLOW_HEADER_PATTERN.test(lines[i])) {
        // Check if this header is within any already-detected section
        const isWithinUsedRange = usedLineRanges.some((range) => i >= range.start && i <= range.end)
        if (!isWithinUsedRange) {
          return i
        }
      }
    }

    // Strategy 2: Look for "---" separator
    // We need to find the section separator that appears before the command reference
    // and after the workflow content. This is less reliable but still useful.
    const separatorIndices: number[] = []
    for (let i = footerIndex - 1; i >= 0; i--) {
      if (LegacyRuleDetector.SECTION_SEPARATOR_PATTERN.test(lines[i])) {
        separatorIndices.push(i)
      }
    }

    // If we found at least one separator, use it as a fallback
    // We want the one closest to the footer but before the "---" that precedes the footer
    if (separatorIndices.length > 0) {
      // The footer line should be preceded by "---", so we skip that one
      // and look for the next separator going backwards
      let candidateIndex: number | undefined
      for (const sepIndex of separatorIndices) {
        const linesBetween = footerIndex - sepIndex
        if (linesBetween === 1) {
          // This is the separator right before the footer, skip it
          continue
        }

        // Check if this separator is within any already-detected section
        const isWithinUsedRange = usedLineRanges.some((range) => sepIndex >= range.start && sepIndex <= range.end)
        if (isWithinUsedRange) {
          continue
        }

        // This could be a section separator within the ByteRover content
        // Use the first one we find (closest to footer)
        candidateIndex = sepIndex + 1
        break
      }

      if (candidateIndex !== undefined && candidateIndex < footerIndex) {
        return candidateIndex
      }
    }

    // Strategy 3: Could not reliably determine start
    return undefined
  }
}
