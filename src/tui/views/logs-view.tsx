/**
 * Logs View
 *
 * Activity log display using ScrollableList with dynamic height calculation
 */

import {Box, Text} from 'ink'
import React, {useCallback} from 'react'

import {LogItem, OnboardingFlow, ScrollableList} from '../components/index.js'
import {useActivityLogs, useMode, useTheme, useUIHeights} from '../hooks/index.js'
import {useOnboarding} from '../hooks/use-onboarding.js'
import {ActivityLog} from '../types.js'
import {calculateActualLogHeight, calculateLogContentLimit} from '../utils/log.js'

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

  // Height calculator that returns the actual rendered height of each log item
  const heightEstimator = useCallback(
    (log: ActivityLog) => {
      // Calculate dynamic content limit for height estimation
      const parts = calculateLogContentLimit(log, scrollableHeight, messageItem)
      const contentPart = parts.find((p) => p.field === 'content')
      const maxContentLine = contentPart?.lines ?? 0

      return calculateActualLogHeight(log, {
        ...messageItem,
        maxContentLines: maxContentLine,
      })
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
