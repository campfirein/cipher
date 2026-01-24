/**
 * Expanded Log View Component
 *
 * Full-screen overlay displaying a single log item with scrollable content.
 * Activated by Ctrl+O on a selected log item, dismissed with Ctrl+O or Esc.
 */

import {Box, Spacer, Text, useInput, useStdout} from 'ink'
import {ScrollView, ScrollViewRef} from 'ink-scroll-view'
import React, {useEffect, useRef, useState} from 'react'

import type {ActivityLog} from '../../types.js'

import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/index.js'
import {StreamingText} from '../streaming-text.js'
import {ExecutionChanges} from './execution-changes.js'
import {ExecutionContent} from './execution-content.js'
import {ExecutionProgress} from './execution-progress.js'

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
  const [hasMoreBelow, setHasMoreBelow] = useState(false)

  const updateScrollIndicator = () => {
    if (!scrollViewRef.current) return
    const currentOffset = scrollViewRef.current.getScrollOffset()
    const maxOffset = scrollViewRef.current.getBottomOffset()
    setHasMoreBelow(currentOffset < maxOffset)
  }

  useEffect(() => {
    const timer = setTimeout(updateScrollIndicator, 50)
    return () => clearTimeout(timer)
  }, [log])

  // Terminal resize handling
  useEffect(() => {
    const handleResize = () => {
      scrollViewRef.current?.remeasure()
      updateScrollIndicator()
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
        updateScrollIndicator()
      }

      if (key.downArrow || input === 'j') {
        const currentOffset = scrollViewRef.current.getScrollOffset()
        const maxOffset = scrollViewRef.current.getBottomOffset()
        const newOffset = Math.min(currentOffset + 1, maxOffset)
        scrollViewRef.current.scrollTo(newOffset)
        updateScrollIndicator()
      }

      if (input === 'g') {
        scrollViewRef.current.scrollTo(0)
        updateScrollIndicator()
      }

      if (input === 'G') {
        scrollViewRef.current.scrollTo(scrollViewRef.current.getBottomOffset())
        updateScrollIndicator()
      }
    },
    {isActive}
  )

  const displayTime = formatTime(log.timestamp)

  return (
    <Box flexDirection="column" height="100%" paddingX={2} width="100%">
      {/* Fixed Header */}
      <Box gap={1}>
        <Text color={colors.primary}>• {log.type}</Text>
        <Spacer />
          <Text backgroundColor={colors.bg2} color={colors.dimText}> [ctrl+o] to collapse </Text>
        <Text color={colors.dimText}>{displayTime}</Text>
      </Box>

      {/* Scrollable content area */}
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" height={availableHeight - 1}>
        <ScrollView height={availableHeight - 2} ref={scrollViewRef}>
          {/* Input */}
          <Box marginBottom={1} paddingX={1}>
            <Text>{log.input}</Text>
          </Box>

          {/* Progress */}
          {(log.toolCalls || log.reasoningContents) && (
            <Box paddingX={1}>
              <ExecutionProgress
                isExpanded
                reasoningContents={log.reasoningContents}
                toolCalls={log.toolCalls}
              />
            </Box>
          )}

          {/* Streaming Text Content - Show when available */}
          {log.streamingContent && log.status === 'running' && (
            <Box paddingX={1}>
              <StreamingText
                content={log.streamingContent}
                isStreaming={Boolean(log.isStreaming)}
                maxLines={0}
                showCursor={Boolean(log.isStreaming)}
              />
            </Box>
          )}

          {/* Content */}
          {(log.status === 'failed' || log.status === 'completed') && (
            <Box paddingX={1}>
              <ExecutionContent
                bottomMargin={0}
                content={log.content ?? ''}
                isError={log.status === 'failed'}
                isExpanded
                maxLines={Number.MAX_SAFE_INTEGER}
              />
            </Box>
          )}

          {/* Changes */}
          {log.status === 'completed' && (
            <Box paddingX={1}>
              <ExecutionChanges
                created={log.changes.created}
                isExpanded
                maxChanges={{
                  created: Number.MAX_SAFE_INTEGER,
                  updated: Number.MAX_SAFE_INTEGER,
                }}
                updated={log.changes.updated}
              />
            </Box>
          )}
        </ScrollView>
        {/* More content indicator */}
        <Box justifyContent="center">
          <Text color={colors.dimText}>{hasMoreBelow ? '↓' : ' '}</Text>
        </Box>
      </Box>
    </Box>
  )
}

