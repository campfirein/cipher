/**
 * Log utility functions for height calculations
 */

import type {MessageItemHeights} from '../hooks/index.js'
import type {ActivityLog} from '../types.js'

/**
 * Calculate the actual rendered height of a log item.
 * This reflects the real space the item takes up when rendered.
 *
 * @param log - The activity log to analyze
 * @param baseHeights - Base height configuration from breakpoint (maxContentLines is optional)
 * @returns Total height in lines that this log item will occupy
 */
export function calculateActualLogHeight(
  log: ActivityLog,
  baseHeights: MessageItemHeights,
): number {
  let totalLines = 0

  // Header: always 1 line
  totalLines += baseHeights.header

  // Input: always present
  totalLines += baseHeights.input

  // Progress: only if there are progress items
  const actualProgress = log.progress?.length ?? 0
  if (actualProgress > 0) {
    totalLines += Math.min(actualProgress, baseHeights.maxProgressItems)
  }

  // Status: always 1 line (from ExecutionStatus)
  totalLines += 1

  // Content: only for completed/failed
  if (log.status === 'completed' || log.status === 'failed') {
    const contentText = log.content ?? ''
    const contentLineCount = contentText.split('\n').length
    totalLines += Math.min(contentLineCount, baseHeights.maxContentLines ?? 10)
    totalLines += baseHeights.contentBottomMargin
  }

  // Changes: only for completed
  if (log.status === 'completed') {
    const actualCreated = log.changes.created.length
    const actualUpdated = log.changes.updated.length

    // Created section
    if (actualCreated > 0) {
      const createdOverflow = actualCreated > baseHeights.maxChanges.created
      const createdItemsMax = createdOverflow ? baseHeights.maxChanges.created - 1 : baseHeights.maxChanges.created
      const displayedCreated = Math.min(actualCreated, createdItemsMax)
      totalLines += displayedCreated + (createdOverflow ? 1 : 0)
    }

    // Updated section
    if (actualUpdated > 0) {
      const updatedOverflow = actualUpdated > baseHeights.maxChanges.updated
      const updatedItemsMax = updatedOverflow ? baseHeights.maxChanges.updated - 1 : baseHeights.maxChanges.updated
      const displayedUpdated = Math.min(actualUpdated, updatedItemsMax)
      totalLines += displayedUpdated + (updatedOverflow ? 1 : 0)
    }
  }

  // Bottom margin
  totalLines += baseHeights.bottomMargin

  return totalLines
}

/**
 * Calculate dynamic space usage for each part of a log
 * Returns array showing how many lines each field uses
 *
 * @param log - The activity log to analyze
 * @param scrollableHeight - Total available height for content area
 * @param baseHeights - Base height configuration from breakpoint
 * @returns Array of { field, lines } showing space breakdown, including calculated content lines
 */

export function calculateLogContentLimit(
  log: ActivityLog,
  scrollableHeight: number,
  baseHeights: Omit<MessageItemHeights, 'maxContentLines'>,
): Array<{field: string; lines: number}> {
  const parts: {field: string; lines: number}[] = []

  parts.push({field: 'header', lines: baseHeights.header}, {field: 'input', lines: baseHeights.input})

  // Progress - based on actual items
  const actualProgress = log.progress?.length ?? 0
  const progressLines = Math.min(actualProgress, baseHeights.maxProgressItems)
  if (progressLines > 0) {
    parts.push({field: 'progress', lines: progressLines})
  }

  // Content bottom margin - only if has content (completed/failed)
  if (log.status === 'completed' || log.status === 'failed') {
    parts.push({field: 'contentBottomMargin', lines: baseHeights.contentBottomMargin})
  }

  // Changes - only if completed
  if (log.status === 'completed') {
    const actualCreated = log.changes.created.length
    const actualUpdated = log.changes.updated.length

    // Created section
    if (actualCreated > 0) {
      const createdOverflow = actualCreated > baseHeights.maxChanges.created
      const createdItemsMax = createdOverflow ? baseHeights.maxChanges.created - 1 : baseHeights.maxChanges.created
      const displayedCreated = Math.min(actualCreated, createdItemsMax)
      const createdLines = displayedCreated + (createdOverflow ? 1 : 0)
      parts.push({field: 'created', lines: createdLines})
    }

    // Updated section
    if (actualUpdated > 0) {
      const updatedOverflow = actualUpdated > baseHeights.maxChanges.updated
      const updatedItemsMax = updatedOverflow ? baseHeights.maxChanges.updated - 1 : baseHeights.maxChanges.updated
      const displayedUpdated = Math.min(actualUpdated, updatedItemsMax)
      const updatedLines = displayedUpdated + (updatedOverflow ? 1 : 0)
      parts.push({field: 'updated', lines: updatedLines})
    }
  }

  // Bottom margin - always present
  parts.push({field: 'bottomMargin', lines: baseHeights.bottomMargin})

  // Calculate content lines: scrollableHeight minus all other parts
  const otherPartsTotal = parts.reduce((sum, part) => sum + part.lines, 0)
  const contentLines = Math.max(0, scrollableHeight - otherPartsTotal)

  // Insert content field (after progress/spinner, before contentBottomMargin)
  const contentBottomMarginIndex = parts.findIndex((p) => p.field === 'contentBottomMargin')
  if (contentBottomMarginIndex === -1) {
    // If no contentBottomMargin, add before bottomMargin
    const bottomMarginIndex = parts.findIndex((p) => p.field === 'bottomMargin')
    parts.splice(bottomMarginIndex, 0, {field: 'content', lines: contentLines})
  } else {
    parts.splice(contentBottomMarginIndex, 0, {field: 'content', lines: contentLines})
  }

  return parts
}
