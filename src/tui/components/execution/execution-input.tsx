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
  /** File references from @filepath syntax */
  files?: string[]
  /** The input text to display */
  input: string
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
}

export const ExecutionInput: React.FC<ExecutionInputProps> = ({files, input, isExpand = false}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 8 // 8 is for padding

  // Build display content: combine input with file references
  let displayContent = input

  if (files && files.length > 0) {
    const fileList = files.map((f) => `@${f}`).join(' ')
    displayContent = input ? `${input}\n\n**Files:** ${fileList}` : `**Files:** ${fileList}`
  }

  // In expand mode, render full content without truncation
  const finalDisplay = isExpand ? displayContent : truncateContent(displayContent, 1, contentWidth).truncatedContent

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      <Markdown>{finalDisplay}</Markdown>
    </Box>
  )
}
