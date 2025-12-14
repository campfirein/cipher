/**
 * Output Log Component
 *
 * Displays command output lines without causing flickering.
 * Uses a simple Box instead of Static to avoid re-render issues.
 */

import {Box, Text} from 'ink'
import React from 'react'

interface OutputLogProps {
  lines: string[]
  logColor?: string
  maxLines?: number
}

export const OutputLog: React.FC<OutputLogProps> = ({lines, logColor, maxLines = 10}) => {
  // Show only the last N lines to prevent overflow
  const visibleLines = lines.slice(-maxLines)

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text color={logColor} key={`${lines.length - maxLines + index}-${line.slice(0, 20)}`}>
          {line}
        </Text>
      ))}
    </Box>
  )
}
