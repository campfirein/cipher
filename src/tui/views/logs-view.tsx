/**
 * Logs View
 *
 * Activity log display using ScrollableList with dynamic height calculation
 */

import {Box, Text} from 'ink'
import React, {useCallback} from 'react'

import {LogItem, OnboardingFlow, ScrollableList} from '../components/index.js'
import {useActivityLogs, useMode, useTheme} from '../hooks/index.js'
import {useOnboarding} from '../hooks/use-onboarding.js'
import {ActivityLog} from '../types.js'

const MAX_PROGRESS_ITEMS = 3

/** Minimum content lines to show before truncation */
const MIN_CONTENT_LINES = 5

/** Reserved lines for log item (header + input box + progress + margins) */
const LOG_ITEM_OVERHEAD = 6

/**
 * Estimate the line height of a log item
 */
function estimateLogHeight(log: ActivityLog, maxContentLines: number): number {
  let lines = 0

  // Header line: [type] @source [timestamp]
  lines += 1

  // Input box with border (top border + content + bottom border)
  lines += 3

  // Progress items (max MAX_PROGRESS_ITEMS shown + optional "more" line)
  const progressCount = Math.min(log.progress?.length ?? 0, MAX_PROGRESS_ITEMS)
  lines += progressCount
  if ((log.progress?.length ?? 0) > MAX_PROGRESS_ITEMS) {
    lines += 1 // "... and X more" line
  }

  // Processing spinner (if running)
  if (log.status === 'running') {
    lines += 1
  }

  // Content (if completed or failed)
  if (log.status === 'completed' || log.status === 'failed') {
    const contentLineCount = log.content?.split('\n').length ?? 0
    // Account for truncation: show max lines + 1 for hint if truncated
    const displayedLines = contentLineCount <= maxContentLines ? contentLineCount : maxContentLines + 1
    lines += displayedLines
  }

  // Changes sections
  if (log.status === 'completed') {
    if (log.changes.created.length > 0) {
      lines += 1 + log.changes.created.length
    }

    if (log.changes.updated.length > 0) {
      lines += 1 + log.changes.updated.length
    }
  }

  // Bottom margin
  lines += 1

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

  // Calculate max content lines based on available height
  const scrollableHeight = Math.max(1, availableHeight - 1)
  const maxContentLines = Math.max(MIN_CONTENT_LINES, scrollableHeight - LOG_ITEM_OVERHEAD)

  const renderLogItem = useCallback(
    (log: ActivityLog) => <LogItem log={log} maxContentLines={maxContentLines} maxProgressItems={MAX_PROGRESS_ITEMS} />,
    [maxContentLines],
  )

  const keyExtractor = useCallback((log: ActivityLog) => log.id, [])

  // Height estimator that accounts for content truncation
  const heightEstimator = useCallback((log: ActivityLog) => estimateLogHeight(log, maxContentLines), [maxContentLines])

  // Show onboarding when project is not initialized
  if (shouldShowOnboarding) {
    return <OnboardingFlow availableHeight={scrollableHeight} />
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
