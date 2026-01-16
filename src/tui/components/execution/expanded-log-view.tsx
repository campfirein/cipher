/**
 * Expanded Log View Component
 *
 * Full-screen overlay displaying a single log item with scrollable content.
 * Activated by Ctrl+O on a selected log item, dismissed with Ctrl+O or Esc.
 */

import {Box, Spacer, Text, useInput, useStdout} from 'ink'
import {ScrollView, ScrollViewRef} from 'ink-scroll-view'
import React, {useEffect, useRef} from 'react'

import type {ActivityLog} from '../../types.js'

import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/index.js'
import {ExecutionChanges} from './execution-changes.js'
import {ExecutionContent} from './execution-content.js'
import {ExecutionProgress} from './execution-progress.js'
import {ExecutionStatus} from './execution-status.js'

interface ExpandedLogViewProps {
  /** Available height for the expanded view (in terminal rows) */
  availableHeight: number
  /** Whether input handling is active */
  isActive: boolean
  /** The log to display in expanded view */
  log: ActivityLog
  /** Callback when the view should close */
  onClose: () => void
}

export const ExpandedLogView: React.FC<ExpandedLogViewProps> = ({
  availableHeight,
  isActive,
  log,
  onClose,
}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const scrollViewRef = useRef<ScrollViewRef>(null)

  // Terminal resize handling
  useEffect(() => {
    const handleResize = () => {
      scrollViewRef.current?.remeasure()
    }

    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  useInput(
    (input, key) => {
      if (!scrollViewRef.current) return

      if ((key.ctrl && input === 'o') || key.escape) {
        onClose()
      }

      if (key.upArrow || input === 'k') {
        scrollViewRef.current.scrollBy(-1)
      }

      if (key.downArrow || input === 'j') {
        const currentOffset = scrollViewRef.current.getScrollOffset()
        const maxOffset = scrollViewRef.current.getBottomOffset()
        const newOffset = Math.min(currentOffset + 1, maxOffset)
        scrollViewRef.current.scrollTo(newOffset)
      }

      if (input === 'g') {
        scrollViewRef.current.scrollTo(0)
      }

      if (input === 'G') {
        scrollViewRef.current.scrollTo(scrollViewRef.current.getBottomOffset())
      }
    },
    {isActive}
  )

  const displayTime = formatTime(log.timestamp)

  return (
    <Box flexDirection="column" height="100%" paddingX={2} width="100%">
      {/* Fixed Header */}
      <Box>
        <Text color={log.type === 'curate' ? colors.curateCommand : colors.queryCommand}>[{log.type}] </Text>
        <Text color={colors.dimText}>@{log.source ?? 'system'}</Text>
        <Text dimColor>  -  [ctrl+o/esc] close | [↑↓/jk] scroll | [g/G] top/bottom</Text>
        <Spacer />
        <Text color={colors.dimText}>[{displayTime}]</Text>
      </Box>

      {/* Scrollable content area */}
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" height={availableHeight - 1}>
        <ScrollView height={availableHeight - 1} ref={scrollViewRef}>
          {/* Input */}
          <Box marginBottom={1} paddingX={1}>
            <Text>{log.input}</Text>
          </Box>

          {/* Progress and Status */}
          <Box flexDirection="column" paddingX={1}>
            {log.progress && (
              <ExecutionProgress isExpand maxLines={Number.MAX_SAFE_INTEGER} progress={log.progress} />
            )}
            <ExecutionStatus status={log.status} />
          </Box>

          {/* Content */}
          {(log.status === 'failed' || log.status === 'completed') && (
            <Box paddingX={1}>
              <ExecutionContent
                bottomMargin={0}
                content={log.content ?? ''}
                isError={log.status === 'failed'}
                isExpand
                maxLines={Number.MAX_SAFE_INTEGER}
              />
            </Box>
          )}

          {/* Changes */}
          {log.status === 'completed' && (
            <Box paddingX={1}>
              <ExecutionChanges
                created={log.changes.created}
                isExpand
                maxChanges={{
                  created: Number.MAX_SAFE_INTEGER,
                  updated: Number.MAX_SAFE_INTEGER,
                }}
                updated={log.changes.updated}
              />
            </Box>
          )}
        </ScrollView>
      </Box>
    </Box>
  )
}
