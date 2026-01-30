/**
 * Execution Reasoning Component
 *
 * Displays LLM reasoning/thinking content with timestamps.
 * Shows accumulated reasoning content items with visual distinction.
 */

import {Box, Text} from 'ink'
import React, {useEffect, useState} from 'react'

import type {ReasoningContentItem} from '../../types/messages.js'

import {useTheme} from '../../hooks/index.js'

/**
 * Animated thinking indicator that cycles through dots: "Thinking." -> "Thinking.." -> "Thinking..."
 */
const ThinkingIndicator: React.FC<{color: string}> = ({color}) => {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1))
    }, 800)

    return () => clearInterval(interval)
  }, [])

  const dots = '.'.repeat(dotCount)

  return (
    <Text color={color} italic>
      Thinking{dots}
    </Text>
  )
}

interface ExecutionReasoningProps {
  /** Whether content should be fully expanded (no truncation) */
  isExpanded?: boolean
  /** Single reasoning content item to display */
  reasoningContent: ReasoningContentItem
}

export const ExecutionReasoning: React.FC<ExecutionReasoningProps> = ({
  isExpanded = false,
  reasoningContent,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const {content, isThinking} = reasoningContent

  if (isThinking && !content) {
    return (
      <Box>
        <ThinkingIndicator color={colors.dimPrimary} />
      </Box>
    )
  }

  // Get first line only when not expanded
  const displayContent = isExpanded ? content : content.split('\n')[0]

  return (
    <Box>
      <Text color={colors.text} wrap={isExpanded ? 'wrap' : 'truncate'}>
        <Text color={colors.dimPrimary} italic>Thinking:</Text> {displayContent}
      </Text>
    </Box>
  )
}
