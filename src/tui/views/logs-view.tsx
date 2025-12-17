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
 * Estimate the line height of a log item
 */
function estimateLogHeight(log: ActivityLog, heights: MessageItemHeights): number {
  let lines = 0

  // Header line: [type] @source [timestamp]
  lines += 1

  // Input box with border (top border + content + bottom border)
  lines += 3

  // Progress
  const actualProgress = log.progress?.length ?? 0
  const displayedProgress = Math.min(actualProgress, heights.maxProgressItems)
  lines += displayedProgress

  // Processing spinner (if running)
  if (log.status === 'running') {
    lines += 1
  }

  // Content (+ hint + bottom margin)
  if (log.status === 'completed' || log.status === 'failed') {
    const actualLines = log.content?.split('\n').length ?? 0
    const displayedLines = Math.min(actualLines, heights.maxContent.max)
    lines += displayedLines + heights.maxContent.bottomMargin
  }

  // Changes (items + separate indicators per section)
  if (log.status === 'completed') {
    const actualCreated = log.changes.created.length
    const actualUpdated = log.changes.updated.length

    // Created section
    if (actualCreated > 0) {
      const createdOverflow = actualCreated > heights.maxChanges.created
      const createdItemsMax = createdOverflow ? heights.maxChanges.created - 1 : heights.maxChanges.created
      const displayedCreated = Math.min(actualCreated, createdItemsMax)
      lines += displayedCreated + (createdOverflow ? 1 : 0) // items + indicator if overflow
    }

    // Updated section
    if (actualUpdated > 0) {
      const updatedOverflow = actualUpdated > heights.maxChanges.updated
      const updatedItemsMax = updatedOverflow ? heights.maxChanges.updated - 1 : heights.maxChanges.updated
      const displayedUpdated = Math.min(actualUpdated, updatedItemsMax)
      lines += displayedUpdated + (updatedOverflow ? 1 : 0) // items + indicator if overflow
    }
  }

  // Bottom margin
  lines += heights.bottomMargin

  return lines
}

interface LogsViewProps {
  availableHeight: number
}

export const LogsView: React.FC<LogsViewProps> = ({availableHeight}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {mode} = useMode()
  const {logs} = useActivityLogs()
  const {shouldShowOnboarding} = useOnboarding()
  const heights = useUIHeights()

  // Calculate max content lines based on available height
  const scrollableHeight = Math.max(1, availableHeight - 1)

  const renderLogItem = useCallback(
    (log: ActivityLog) => <LogItem heights={heights.messageItem} log={log} />,
    [heights.messageItem],
  )

  const keyExtractor = useCallback((log: ActivityLog) => log.id, [])

  // Height estimator that accounts for content truncation
  const heightEstimator = useCallback(
    (log: ActivityLog) => estimateLogHeight(log, heights.messageItem),
    [heights.messageItem],
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
