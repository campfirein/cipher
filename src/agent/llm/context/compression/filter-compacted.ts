/**
 * Filter compacted messages utility.
 *
 * This module provides read-time filtering of message history based on
 * compression metadata. When a summary message exists (with metadata.isSummary === true),
 * messages before it are filtered out since they've been summarized.
 *
 * Key design principles:
 * - Full history preserved in storage (audit trail)
 * - Filtering happens at read-time, not storage-time
 * - Summary message marks the boundary
 *
 * Based on dexto's filterCompacted() pattern.
 */

import type {InternalMessage} from '../../../interfaces/message-types.js'

/**
 * Filter history to exclude messages before the most recent summary.
 *
 * When a summary message exists (metadata.isSummary === true), this function
 * returns only the summary message and everything after it. This implements
 * read-time compression where old messages are logically hidden but physically
 * preserved in storage.
 *
 * @param history - Full message history to filter
 * @returns Filtered history with old messages excluded
 *
 * @example
 * ```typescript
 * // Before filtering: [msg1, msg2, msg3, summaryMsg, msg4, msg5]
 * // After filtering:  [summaryMsg, msg4, msg5]
 *
 * const filtered = filterCompacted(history);
 * ```
 */
export function filterCompacted(history: readonly InternalMessage[]): InternalMessage[] {
  if (!history || history.length === 0) {
    return []
  }

  // Find the most recent summary message (search backwards for efficiency)
  let summaryIndex = -1
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg?.metadata?.isSummary === true) {
      summaryIndex = i
      break
    }
  }

  // If no summary found, return full history
  if (summaryIndex === -1) {
    return [...history]
  }

  // Return summary + everything after it
  return history.slice(summaryIndex)
}

/**
 * Check if history contains a summary message.
 *
 * Useful for determining if filtering would have any effect.
 *
 * @param history - Message history to check
 * @returns true if history contains a summary message
 */
export function hasSummaryMessage(history: readonly InternalMessage[]): boolean {
  if (!history || history.length === 0) return false

  return history.some((msg) => msg?.metadata?.isSummary === true)
}

/**
 * Find the summary message in history.
 *
 * @param history - Message history to search
 * @returns The summary message or undefined if not found
 */
export function findSummaryMessage(history: readonly InternalMessage[]): InternalMessage | undefined {
  if (!history || history.length === 0) return undefined

  // Search backwards to find the most recent summary
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg?.metadata?.isSummary === true) {
      return msg
    }
  }

  return undefined
}

/**
 * Get the count of messages that would be filtered out.
 *
 * @param history - Message history to analyze
 * @returns Number of messages before the summary that would be filtered
 */
export function getFilteredMessageCount(history: readonly InternalMessage[]): number {
  if (!history || history.length === 0) return 0

  // Find summary index
  let summaryIndex = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.metadata?.isSummary === true) {
      summaryIndex = i
      break
    }
  }

  // No summary = nothing filtered
  if (summaryIndex === -1) return 0

  // Count messages before the summary
  return summaryIndex
}

/**
 * Get summary statistics about compression state.
 *
 * @param history - Message history to analyze
 * @returns Statistics about the compression state
 */
export function getCompressionStats(history: readonly InternalMessage[]): {
  /** When compression occurred (from summary metadata) */
  compactedAt?: number
  /** Whether history has been compressed */
  hasCompression: boolean
  /** Number of messages hidden by compression */
  hiddenMessageCount: number
  /** Number of messages that were summarized (from summary metadata) */
  summarizedMessageCount: number
  /** Number of messages currently visible (after filtering) */
  visibleMessageCount: number
} {
  if (!history || history.length === 0) {
    return {
      hasCompression: false,
      hiddenMessageCount: 0,
      summarizedMessageCount: 0,
      visibleMessageCount: 0,
    }
  }

  const summaryMessage = findSummaryMessage(history)

  if (!summaryMessage) {
    return {
      hasCompression: false,
      hiddenMessageCount: 0,
      summarizedMessageCount: 0,
      visibleMessageCount: history.length,
    }
  }

  const filtered = filterCompacted(history)
  const hiddenCount = history.length - filtered.length

  return {
    compactedAt: summaryMessage.metadata?.compactedAt as number | undefined,
    hasCompression: true,
    hiddenMessageCount: hiddenCount,
    summarizedMessageCount: (summaryMessage.metadata?.summarizedMessageCount as number) || hiddenCount,
    visibleMessageCount: filtered.length,
  }
}

/**
 * Check if a message is a summary message.
 *
 * @param message - Message to check
 * @returns true if the message is a summary
 */
export function isSummaryMessage(message: InternalMessage): boolean {
  return message?.metadata?.isSummary === true
}
