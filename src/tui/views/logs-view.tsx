/**
 * Logs View
 *
 * Activity log display using ScrollableList with dynamic height calculation
 */

import {Box, useInput, useStdout} from 'ink'
import {ScrollList, ScrollListRef} from 'ink-scroll-list'
import React, {useCallback, useEffect, useRef, useState} from 'react'

import {ExpandedLogView, LogItem, OnboardingFlow, WelcomeBox} from '../components/index.js'
import {useAuth} from '../contexts/index.js'
import {useActivityLogs, useMode, useTheme, useUIHeights} from '../hooks/index.js'
import {useOnboarding} from '../hooks/use-onboarding.js'
import {ActivityLog} from '../types.js'
import {InitView} from './init-view.js'

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
  const {isLoadingDismissed, shouldShowOnboarding} = useOnboarding()
  const {messageItem} = useUIHeights()
  const {brvConfig} = useAuth()
  const [initFlowCompleted, setInitFlowCompleted] = useState(Boolean(brvConfig))
  const scrollListRef = useRef<ScrollListRef>(null)
  const {stdout} = useStdout()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedViewLogId, setExpandedViewLogId] = useState<null | string>(null)

  // Calculate scrollable height for dynamic per-log calculations
  const scrollableHeight = Math.max(1, availableHeight)

  const handleInitEnd = () => {
    setInitFlowCompleted(true)
  }

  useEffect(() => {
    const handleResize = () => {
      scrollListRef.current?.remeasure()
    }

    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (logs.length === 0) return
    setSelectedIndex(logs.length - 1)
  }, [logs.length])

  // Navigation in list view
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        const selectedLog = logs[selectedIndex]
        if (!selectedLog) return

        setExpandedViewLogId(selectedLog.id)
      }

      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1))
      }

      if (key.downArrow || input === 'j') {
        setSelectedIndex((prev) => Math.min(prev + 1, logs.length - 1))
      }

      if (input === 'g') {
        setSelectedIndex(0)
      }

      if (input === 'G') {
        setSelectedIndex(logs.length - 1)
      }
    },
    {isActive: mode === 'activity' && logs.length > 0 && !expandedViewLogId}
  )

  const renderLogItem = useCallback(
    (log: ActivityLog, index: number) => {
      const isSelected = index === selectedIndex

      return (
        <LogItem
          heights={{
            ...messageItem,
            maxContentLines: 2,
          }}
          isExpand={false}
          isSelected={isSelected}
          log={log}
        />
      )
    },
    [messageItem, selectedIndex]
  )

  // Find the expanded log
  const expandedLog = expandedViewLogId ? logs.find((log) => log.id === expandedViewLogId) : null

  if (isLoadingDismissed) {
    return null
  }

  if (shouldShowOnboarding) {
    return <OnboardingFlow availableHeight={availableHeight} onInitComplete={handleInitEnd} />
  }

  // Show init view if config doesn't exist and user hasn't completed init flow
  if (!initFlowCompleted) {
    return <InitView availableHeight={availableHeight} onInitComplete={handleInitEnd} />
  }

  // Show expanded view if a log is selected for expansion
  if (expandedLog) {
    return (
      <ExpandedLogView
        availableHeight={availableHeight}
        isActive={mode === 'activity'}
        log={expandedLog}
        onClose={() => setExpandedViewLogId(null)}
      />
    )
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
          <ScrollList
            height={scrollableHeight}
            ref={scrollListRef}
            scrollAlignment="auto"
            selectedIndex={selectedIndex}
          >
            {logs.map((log, index) => (
              <Box key={log.id}>{renderLogItem(log, index)}</Box>
            ))}
          </ScrollList>
        </Box>
      ) : (
        <WelcomeBox isCopyActive={mode === 'activity' && logs.length === 0} />
      )}
    </Box>
  )
}
