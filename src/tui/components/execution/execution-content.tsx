/**
 * Execution Content Component
 *
 * Displays execution content (result or error) with truncation support.
 */

import { Box, Text, useStdout } from 'ink'
import React from 'react'

import { useTheme } from '../../hooks/index.js'
import { getVisualLineCount } from '../../utils/line.js'

const DEFAULT_MAX_LINES = 5

/**
 * Truncate content string to maxLines, returning truncated content and remaining line count.
 * Accounts for line wrapping when maxCharsPerLine is provided.
 */
export function truncateContent(
  content: string,
  maxLines: number,
  maxCharsPerLine?: number,
): { remainingLines: number; totalLines: number; truncatedContent: string } {
  const lines = (content ?? '').split('\n')

  // Calculate total visual lines (accounting for wrapping)
  let totalVisualLines = 0
  for (const line of lines) {
    totalVisualLines += maxCharsPerLine ? getVisualLineCount(line, maxCharsPerLine) : 1
  }

  if (totalVisualLines <= maxLines) {
    return { remainingLines: 0, totalLines: totalVisualLines, truncatedContent: content }
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

  // Replace last 3 characters of last line with "..." if truncated
  let finalContent = truncatedLines.join('\n')
  if (truncatedLines.length > 0 && totalVisualLines > visualLineCount) {
    const lastLineIndex = truncatedLines.length - 1
    const lastLine = truncatedLines[lastLineIndex]

    if (lastLine.length >= 3) {
      truncatedLines[lastLineIndex] = lastLine.slice(0, -3) + '...'
      finalContent = truncatedLines.join('\n')
    } else if (lastLine.length > 0) {
      // If last line is shorter than 3 chars, just replace entirely with "..."
      truncatedLines[lastLineIndex] = '...'
      finalContent = truncatedLines.join('\n')
    }
  }

  return {
    remainingLines: totalVisualLines - visualLineCount,
    totalLines: totalVisualLines,
    truncatedContent: finalContent,
  }
}

interface ExecutionContentProps {
  /** Bottom margin for this content section */
  bottomMargin?: number
  /** The content to display */
  content: string
  /** Whether this is error content */
  isError?: boolean
  /** Maximum number of lines (rows) this component can use, including the "more lines" indicator */
  maxLines?: number
}

export const ExecutionContent: React.FC<ExecutionContentProps> = ({
  bottomMargin = 1,
  content,
  isError = false,
  maxLines = DEFAULT_MAX_LINES,
}) => {
  const {
    theme: { colors },
  } = useTheme()
  const { stdout } = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 4 // 4 is for padding

  if (!content) {
    return null
  }

  // First check if content would overflow
  const { totalLines } = truncateContent(content, maxLines, contentWidth)
  const hasOverflow = totalLines > maxLines

  // If overflow, reserve 1 line for indicator, show (maxLines - 1) lines of content
  const effectiveMaxLines = hasOverflow ? maxLines - 1 : maxLines
  const { remainingLines, truncatedContent } = truncateContent(content, effectiveMaxLines, contentWidth)

  return (
    <Box flexDirection="column" marginBottom={bottomMargin}>
      <Text color={isError ? colors.errorText : colors.text}>{truncatedContent}</Text>
      {remainingLines > 0 && <Text color={colors.dimText}>↕ {remainingLines} more lines</Text>}
    </Box>
  )
}
