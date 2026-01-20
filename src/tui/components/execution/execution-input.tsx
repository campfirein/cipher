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
}

export const ExecutionInput: React.FC<ExecutionInputProps> = ({input}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 8 // 8 is for padding
  const {truncatedContent} = truncateContent(input, 1, contentWidth)

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column">
      <Markdown>{truncatedContent}</Markdown>
    </Box>
  )
}
