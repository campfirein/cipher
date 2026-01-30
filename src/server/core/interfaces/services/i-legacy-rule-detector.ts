import type {Agent} from '../../domain/entities/agent.js'

/**
 * Represents a reliably detected legacy ByteRover rule section.
 */
export type LegacyRuleMatch = {
  /**
   * Content of the detected section.
   */
  content: string

  /**
   * Ending line number (1-indexed)
   */
  endLine: number

  /**
   * Starting line number (1-indexed)
   */
  startLine: number
}

/**
 * Represents an uncertain detection where the footer was found but start couldn't be reliably determined.
 */
export type UncertainMatch = {
  /**
   * Line number where the footer tag was found (1-indexed).
   */
  footerLine: number

  /**
   * Reason why the start couldn't be determined.
   */
  reason: string
}

/**
 * Result of detecting legacy ByteRover rules in a file.
 */
export type LegacyRuleDetectionResult = {
  /**
   * Reliably detected rule sections with known start and end positions.
   */
  reliableMatches: LegacyRuleMatch[]

  /**
   * Uncertain matches where only the footer was found.
   */
  uncertainMatches: UncertainMatch[]
}

/**
 * Service for detecting legacy ByteRover rules (without boundary markers) in instruction files.
 */
export interface ILegacyRuleDetector {
  /**
   * Detects legacy ByteRover rule sections in file content.
   * @param content The file content to analyze.
   * @param agentName The agent name to look for in the footer tag.
   * @returns Detection result with reliable and uncertain matches.
   */
  detectLegacyRules: (content: string, agentName: Agent) => LegacyRuleDetectionResult
}
