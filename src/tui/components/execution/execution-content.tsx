/**
 * Execution Content Component
 *
 * Displays execution content (result or error) with truncation support.
 */

import {Box, Text, useStdout} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'

/**
 * Calculate visual line count for a single line, accounting for wrapping
 */
function getVisualLineCount(line: string, maxCharsPerLine: number): number {
  if (maxCharsPerLine <= 0 || line.length === 0) {
    return 1
  }

  return Math.ceil(line.length / maxCharsPerLine) || 1
}

/**
 * Truncate content string to maxLines, returning truncated content and remaining line count.
 * Accounts for line wrapping when maxCharsPerLine is provided.
 */
export function truncateContent(
  content: string,
  maxLines: number,
  maxCharsPerLine?: number,
): {remainingLines: number; totalLines: number; truncatedContent: string} {
  const lines = content.split('\n')

  // Calculate total visual lines (accounting for wrapping)
  let totalVisualLines = 0
  for (const line of lines) {
    totalVisualLines += maxCharsPerLine ? getVisualLineCount(line, maxCharsPerLine) : 1
  }

  if (totalVisualLines <= maxLines) {
    return {remainingLines: 0, totalLines: totalVisualLines, truncatedContent: content}
  }

  // Build truncated content respecting visual line limit
  const truncatedLines: string[] = []
  let visualLineCount = 0

  for (const line of lines) {
    const lineVisualCount = maxCharsPerLine ? getVisualLineCount(line, maxCharsPerLine) : 1

    if (visualLineCount + lineVisualCount <= maxLines) {
      truncatedLines.push(line)
      visualLineCount += lineVisualCount
    } else {
      // Partial line truncation if needed
      if (maxCharsPerLine && visualLineCount < maxLines) {
        const remainingVisualLines = maxLines - visualLineCount
        const maxChars = remainingVisualLines * maxCharsPerLine
        truncatedLines.push(line.slice(0, maxChars))
        visualLineCount = maxLines
      }

      break
    }
  }

  return {
    remainingLines: totalVisualLines - visualLineCount,
    totalLines: totalVisualLines,
    truncatedContent: truncatedLines.join('\n'),
  }
}

interface ExecutionContentProps {
  /** The content to display */
  content: string
  /** Whether this is error content */
  isError?: boolean
  /** Maximum number of lines before truncation */
  maxLines: number
}

export const ExecutionContent: React.FC<ExecutionContentProps> = ({content, isError = false, maxLines}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 4 // 4 is for padding

  if (!content) {
    return null
  }

  const {remainingLines, truncatedContent} = truncateContent(content, maxLines, contentWidth)

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={isError ? colors.errorText : colors.text}>{truncatedContent}</Text>
      {remainingLines > 0 && <Text color={colors.dimText}>↕ {remainingLines} more lines</Text>}
    </Box>
  )
}
