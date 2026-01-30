/**
 * Streaming Text Component
 *
 * Displays incrementally streaming text content with an optional
 * animated cursor indicator. Used for real-time LLM response display.
 *
 * Pattern inspired by OpenCode's streaming UI implementation.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {memo} from 'react'

import {useTheme} from '../hooks/index.js'
import {Markdown} from './markdown.js'

interface StreamingTextProps {
  /** The accumulated streaming content to display */
  content: string
  /** Whether streaming is still in progress */
  isStreaming: boolean
  /** Maximum lines to display (0 = unlimited) */
  maxLines?: number
  /** Whether to show the streaming cursor/indicator */
  showCursor?: boolean
}

/**
 * Memoized spinner component to prevent unnecessary re-renders
 */
const GeneratingSpinner = memo(() => {
  const {
    theme: {colors},
  } = useTheme()

  return (
    <Text color={colors.dimText}>
      <Spinner type="dots" />
    </Text>
  )
})
GeneratingSpinner.displayName = 'GeneratingSpinner'

/**
 * Component that displays streaming text with real-time updates.
 *
 * Features:
 * - Markdown rendering for formatted content
 * - Animated spinner during streaming
 * - Optional line limiting for compact views
 * - Smooth transition when streaming completes
 */
export const StreamingText: React.FC<StreamingTextProps> = memo(({
  content,
  isStreaming,
  maxLines = 0,
  showCursor = true,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  // Truncate content if maxLines is specified
  const displayContent = maxLines > 0 ? truncateToLines(content, maxLines) : content

  // Don't render anything if no content
  if (!content) {
    return isStreaming ? (
      <Box>
        <GeneratingSpinner />
        <Text color={colors.dimText}> Generating...</Text>
      </Box>
    ) : null
  }

  return (
    <Box flexDirection="column">
      <Markdown>{displayContent}</Markdown>
      {isStreaming && showCursor && (
        <Box marginTop={1}>
          <GeneratingSpinner />
          <Text color={colors.dimText}> Generating...</Text>
        </Box>
      )}
    </Box>
  )
})
StreamingText.displayName = 'StreamingText'

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
