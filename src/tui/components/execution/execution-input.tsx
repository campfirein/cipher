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
  /** Folder references from @folderpath syntax */
  folders?: string[]
  /** The input text to display */
  input: string
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
}

export const ExecutionInput: React.FC<ExecutionInputProps> = ({files, folders, input, isExpand = false}) => {
  const {
    theme: {colors},
  } = useTheme()
  const {stdout} = useStdout()
  const contentWidth = (stdout?.columns ?? 80) - 8 // 8 is for padding

  // Build display content: combine input with file/folder references
  let displayContent = input

  // Add folder references first (if any)
  if (folders && folders.length > 0) {
    const folderList = folders.map((f) => `@${f}`).join(' ')
    displayContent = input ? `${input}\n\n**Folders:** ${folderList}` : `**Folders:** ${folderList}`
  }

  // Add file references (if any)
  if (files && files.length > 0) {
    const fileList = files.map((f) => `@${f}`).join(' ')
    displayContent = displayContent ? `${displayContent}\n\n**Files:** ${fileList}` : `**Files:** ${fileList}`
  }

  // In expand mode, render full content without truncation
  const finalDisplay = isExpand ? displayContent : truncateContent(displayContent, 1, contentWidth).truncatedContent

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      <Markdown>{finalDisplay}</Markdown>
    </Box>
  )
}
