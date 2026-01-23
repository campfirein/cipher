/**
 * Reasoning Text Component
 *
 * Displays LLM thinking/reasoning content with distinct visual styling.
 * Following OpenCode's pattern: muted colors, left border, "Thinking:" prefix.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {memo} from 'react'

import {useTheme} from '../hooks/index.js'

interface ReasoningTextProps {
  /** The accumulated reasoning content to display */
  content: string
  /** Whether reasoning is still in progress */
  isStreaming: boolean
  /** Maximum lines to display (0 = unlimited) */
  maxLines?: number
}

/**
 * Memoized spinner component to prevent unnecessary re-renders
 */
const ThinkingSpinner = memo(() => {
  const {
    theme: {colors},
  } = useTheme()

  return (
    <Text color={colors.dimText}>
      <Spinner type="dots" />
    </Text>
  )
})
ThinkingSpinner.displayName = 'ThinkingSpinner'

/**
 * Component that displays thinking/reasoning content with visual distinction.
 *
 * Features:
 * - Left border to visually separate from regular content
 * - Muted/dim colors to indicate background reasoning
 * - "Thinking:" prefix for clarity
 * - Animated spinner during streaming
 */
export const ReasoningText: React.FC<ReasoningTextProps> = memo(({content, isStreaming, maxLines = 0}) => {
  const {
    theme: {colors},
  } = useTheme()

  // Truncate content if maxLines is specified
  const displayContent = maxLines > 0 ? truncateToLines(content, maxLines) : content

  // Don't render anything if no content
  if (!content) {
    return isStreaming ? (
      <Box paddingLeft={2}>
        <ThinkingSpinner />
        <Text color={colors.dimText}> Thinking...</Text>
      </Box>
    ) : null
  }

  return (
    <Box borderColor={colors.border} borderLeft borderStyle="single" flexDirection="column" paddingLeft={2}>
      <Box>
        <Text color={colors.dimText} italic>
          Thinking:
        </Text>
        {isStreaming && (
          <Text color={colors.dimText}>
            {' '}
            <ThinkingSpinner />
          </Text>
        )}
      </Box>
      <Text color={colors.dimText} wrap="wrap">
        {displayContent}
      </Text>
    </Box>
  )
})
ReasoningText.displayName = 'ReasoningText'

/**
 * Truncate content to specified number of lines
 */
function truncateToLines(content: string, maxLines: number): string {
  const lines = content.split('\n')
  if (lines.length <= maxLines) {
    return content
  }

  return lines.slice(0, maxLines).join('\n') + '\n...'
}
