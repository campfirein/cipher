/**
 * Execution Reasoning Component
 *
 * Displays LLM reasoning/thinking content with timestamps.
 * Shows accumulated reasoning content items with visual distinction.
 */

import {Box, Text} from 'ink'
import React from 'react'

import type {ReasoningContentItem} from '../../types/messages.js'

import {useTheme} from '../../hooks/index.js'

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
        <Text color={colors.dimPrimary} italic>Thinking...</Text>
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
