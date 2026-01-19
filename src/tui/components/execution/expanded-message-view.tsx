/**
 * Expanded Message View Component
 *
 * Full-screen overlay displaying a single command message with scrollable output.
 * Activated by Ctrl+O on a selected message, dismissed with Ctrl+O or Esc.
 */

import {Box, Spacer, Text, useInput, useStdout} from 'ink'
import {ScrollView, ScrollViewRef} from 'ink-scroll-view'
import React, {useEffect, useRef, useState} from 'react'

import type {CommandMessage} from '../../types.js'

import {useTheme} from '../../hooks/index.js'

interface ExpandedMessageViewProps {
  /** Available height for the expanded view (in terminal rows) */
  availableHeight: number
  /** Whether input handling is active */
  isActive: boolean
  /** The message to display in expanded view */
  message: CommandMessage
  /** Index of the message */
  messageIndex: number
  /** Callback when the view should close */
  onClose: () => void
  /** Render function for the message item */
  renderMessageItem: (msg: CommandMessage, index: number, isExpanded?: boolean) => React.ReactNode
}

export const ExpandedMessageView: React.FC<ExpandedMessageViewProps> = ({
  availableHeight,
  isActive,
  message,
  messageIndex,
  onClose,
  renderMessageItem,
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

  // Initial scroll position check
  useEffect(() => {
    // Delay to allow ScrollView to measure content
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

  return (
    <Box flexDirection="column" height="100%" paddingX={2} width="100%">
      {/* Fixed Header */}
      <Box>
        <Text dimColor>[ctrl+o/esc] close | [↑↓/jk] scroll | [g/G] top/bottom</Text>
        <Spacer />
      </Box>

      {/* Scrollable content area */}
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" flexGrow={1} height={availableHeight - 1}>
        <ScrollView height={availableHeight - 2} ref={scrollViewRef}>
          {renderMessageItem(message, messageIndex, true)}
        </ScrollView>
        {/* More content indicator */}
        <Box justifyContent="center">
          <Text color={colors.dimText}>{hasMoreBelow ? "↓" : " "}</Text>
        </Box>
      </Box>

    </Box>
  )
}
