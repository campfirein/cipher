/**
 * Execution Input Component
 *
 * Displays the input text in a bordered box.
 */

import {Box, Text, useStdout} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'
import {truncateContent} from './execution-content.js'

interface ExecutionInputProps {
  /** The input text to display */
  input: string
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
}

export const ExecutionInput: React.FC<ExecutionInputProps> = ({input, isExpand = false}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 8 // 8 is for padding

  // In expand mode, render full input without truncation
  const displayInput = isExpand ? input : truncateContent(input, 1, contentWidth).truncatedContent

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column">
      <Text wrap="truncate">{displayInput}</Text>
    </Box>
  )
}
