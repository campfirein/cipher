/**
 * Expanded Message View Component
 *
 * Full-screen overlay displaying a command message with scrollable output.
 * Activated by Ctrl+O on a selected command message, dismissed with Ctrl+O or Esc.
 */

import {Box, Spacer, Text, useInput, useStdout} from 'ink'
import {ScrollView, ScrollViewRef} from 'ink-scroll-view'
import React, {useEffect, useRef, useState} from 'react'

import type {CommandMessage} from '../../types.js'

import {useCommands} from '../../contexts/commands-context.js'
import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/index.js'
import {MessageItem} from '../message-item.js'
import {CommandOutput} from './command-output.js'
import {LiveStreamingOutput} from './index.js'

export interface ExpandedCommandViewProps {
  /** Available height for the expanded view (in terminal rows) */
  availableHeight: number
  /** Whether input handling is active */
  isActive: boolean
  /** The command message to display in expanded view */
  message: CommandMessage
  /** Callback when the view should close */
  onClose: () => void
  /** Terminal width for text wrapping calculations */
  terminalWidth: number
}

export const ExpandedCommandView: React.FC<ExpandedCommandViewProps> = ({
  availableHeight,
  isActive,
  message,
  onClose,
  terminalWidth,
}) => {
  const {activePrompt, isStreaming, streamingMessages} = useCommands()
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
  }, [message])

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

  const displayTime = message.timestamp ? formatTime(message.timestamp) : ''
  const hasCompletedOutput = message.output && message.output.length > 0
  const showLiveOutput = (isStreaming || activePrompt) && (streamingMessages.length > 0 || activePrompt)

  if (message.type === 'error') {
    return <MessageItem isActive={isActive} isExpanded message={message} onClose={onClose} />
  }

  return (
    <Box flexDirection="column" height="100%" paddingBottom={1} width="100%">
      {/* Fixed Header */}
      <Box gap={1}>
        <Text color={colors.primary}>• {message.fromCommand}</Text>
        <Spacer />
        <Text color={colors.dimText}>{displayTime}</Text>
      </Box>

      {/* Scrollable content area */}
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" height={availableHeight - 1}>
        <ScrollView height={availableHeight - 4} ref={scrollViewRef}>
          <Box flexDirection="column" paddingX={1}>
            {!hasCompletedOutput && showLiveOutput && (
              <LiveStreamingOutput
                activePrompt={activePrompt}
                isExpanded
                isStreaming={isStreaming}
                streamingMessages={streamingMessages}
                terminalWidth={terminalWidth}
              />
            )}

            {hasCompletedOutput && (
              <CommandOutput isExpanded output={message.output!} terminalWidth={terminalWidth} />
            )}

            {!hasCompletedOutput && !showLiveOutput && (
              <Text color={colors.dimText}>No output</Text>
            )}
          </Box>
        </ScrollView>
        {/* More content indicator */}
        <Box justifyContent="center">
          <Text color={colors.dimText}>{hasMoreBelow ? '↓' : ' '}</Text>
        </Box>
      </Box>
      <Box>
        <Text color={colors.dimText}>[ctrl+o] to collapse</Text>
      </Box>
    </Box>
  )
}
