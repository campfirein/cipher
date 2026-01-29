/**
 * Interface for session normalization utilities
 * Provides standardized transformation of raw session data to clean normalized format
 */
import { CleanMessage, CleanSession, SessionType } from '../../domain/entities/parser.js'

export interface ISessionNormalizer {
  /**
   * Add turn_id to each message based on order
   *
   * @param messages - Array of messages to assign turn IDs to
   * @returns Array of messages with turn_id property added
   */
  addTurnIds(messages: CleanMessage[]): CleanMessage[]

  /**
   * Combine tool_use and tool_result messages
   *
   * @param messages - Array of clean messages to process
   * @returns Array of messages with combined tool execution blocks
   */
  combineToolResults(messages: CleanMessage[]): CleanMessage[]

  /**
   * Extract unique workspace paths from session messages and metadata
   *
   * @param messages - Array of clean messages to extract paths from
   * @param metadata - Session metadata object (may contain cwd property)
   * @param existingPaths - Optional pre-existing paths to include
   * @returns Sorted array of unique workspace paths
   */
  extractWorkspacePaths(messages: CleanMessage[], metadata: unknown, existingPaths?: string[]): string[]

  /**
   * Normalize message content to always be an array of content blocks
   *
   * @param content - Content to normalize (can be string, array of blocks, object, or any value)
   * @returns Array of normalized ContentBlock objects
   */
  normalizeContent(content: unknown): unknown[]

  /**
   * Normalize a single content block
   *
   * @param block - Block to normalize (string, object, or any value)
   * @returns Normalized ContentBlock with proper type inference
   */
  normalizeContentBlock(block: unknown): unknown

  /**
   * Normalize session to clean format
   *
   * Transforms raw session data into standardized CleanSession format. Normalizes message
   * content to content blocks, combines tool calls with results, assigns turn IDs,
   * and extracts workspace paths.
   *
   * @param session - Raw session object with messages and metadata
   * @param sessionType - Type of session (Claude, Copilot, Cursor, Codex)
   * @returns Normalized CleanSession with standardized format
   */
  normalizeSession(session: Record<string, unknown>, sessionType?: SessionType): CleanSession
}
