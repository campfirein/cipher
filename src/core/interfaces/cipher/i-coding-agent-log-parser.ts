import type {ParsedInteraction} from '../../domain/cipher/parsed-interaction.js'

/**
 * Interface for parsing coding agent log files.
 * Implementations should handle different log formats from various coding agents
 * (Claude Code, GitHub Copilot, Cursor, Codex, etc.).
 */
export interface ICodingAgentLogParser {
  /**
   * Determines if a file is a valid log file that can be parsed.
   * This method should perform quick validation (e.g., file extension check)
   * without reading the entire file.
   * @param filePath Absolute path to the file
   * @returns true if the file can be parsed, false otherwise
   */
  isValidLogFile: (filePath: string) => boolean

  /**
   * Parses a coding agent log file and extracts interactions.
   * @param filePath Absolute path to the log file
   * @returns A promise that resolves to an array of ParsedInteraction objects
   */
  parseLogFile: (filePath: string) => Promise<ParsedInteraction[]>
}
