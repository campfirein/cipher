/**
 * Logs View
 *
 * Activity log display using ScrollableList with dynamic height calculation
 */

import {Box, Text} from 'ink'
import React, {useCallback} from 'react'

import type {MessageItemHeights} from '../hooks/index.js'

import {LogItem, OnboardingFlow, ScrollableList} from '../components/index.js'
import {useActivityLogs, useMode, useTheme, useUIHeights} from '../hooks/index.js'
import {useOnboarding} from '../hooks/use-onboarding.js'
import {ActivityLog} from '../types.js'

/**
 * Calculate dynamic space usage for each part of a log
 * Returns array showing how many lines each field uses
 *
 * @param log - The activity log to analyze
 * @param scrollableHeight - Total available height for content area
 * @param baseHeights - Base height configuration from breakpoint
 * @returns Array of { field, lines } showing space breakdown, including calculated content lines
 */
function calculateLogContentLimit(
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

interface LogsViewProps {
  /**
   * Available height for the logs view content area (in terminal rows)
   *
   * Calculated as: `terminalHeight - header - tab - footer`
   *
   * This represents the vertical space allocated for scrollable log content
   * after accounting for fixed UI elements (header, tab bar, footer).
   * Internally adjusted to `availableHeight - 1` for border spacing.
   *
   * @example
   * // Terminal: 30 rows, header: 2, tab: 3, footer: 1
   * // availableHeight = 30 - 2 - 3 - 1 = 24 rows for content
   */
  availableHeight: number
}

export const LogsView: React.FC<LogsViewProps> = ({availableHeight}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode} = useMode()
  const {logs} = useActivityLogs()
  const {shouldShowOnboarding} = useOnboarding()
  const {messageItem} = useUIHeights()

  // Calculate scrollable height for dynamic per-log calculations
  const scrollableHeight = Math.max(1, availableHeight)

  const renderLogItem = useCallback(
    (log: ActivityLog) => {
      // Calculate dynamic content limit for this specific log
      const parts = calculateLogContentLimit(log, scrollableHeight, messageItem)
      const contentPart = parts.find((p) => p.field === 'content')
      const maxContentLine = contentPart?.lines ?? 0

      return (
        <LogItem
          heights={{
            ...messageItem,
            maxContentLines: maxContentLine,
          }}
          log={log}
        />
      )
    },
    [messageItem, scrollableHeight],
  )

  const keyExtractor = useCallback((log: ActivityLog) => log.id, [])

  // Height estimator that accounts for content truncation
  const heightEstimator = useCallback(
    (log: ActivityLog) => {
      // Calculate all parts and sum their line counts
      const parts = calculateLogContentLimit(log, scrollableHeight, messageItem)
      return parts.reduce((sum, part) => sum + part.lines, 0)
    },
    [messageItem, scrollableHeight],
  )

  // Show onboarding when project is not initialized
  if (shouldShowOnboarding) {
    return <OnboardingFlow availableHeight={availableHeight} />
  }

  return (
    <Box
      borderColor={colors.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      height="100%"
      width="100%"
    >
      {logs.length > 0 ? (
        <Box flexDirection="column" height="100%" paddingX={2}>
          <ScrollableList
            autoScrollToBottom
            availableHeight={scrollableHeight}
            estimateItemHeight={heightEstimator}
            isActive={mode === 'activity'}
            items={logs}
            keyExtractor={keyExtractor}
            renderItem={renderLogItem}
          />
        </Box>
      ) : (
        <>
          <Text color={colors.primary}>Welcome to ByteRover!</Text>
          <Text color={colors.text}>Start by telling your AI Agent what to save or retrieve.</Text>
          <Box marginTop={1}>
            <Text color={colors.text} dimColor>
              Press [Tab] to switch to commands view
            </Text>
          </Box>
        </>
      )}
    </Box>
  )
}
