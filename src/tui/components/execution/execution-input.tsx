/**
 * Execution Input Component
 *
 * Displays the input text in a bordered box.
 */

import {Box, useStdout} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'
import {Markdown} from '../markdown.js'
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
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      <Markdown>{displayInput}</Markdown>
    </Box>
  )
}
