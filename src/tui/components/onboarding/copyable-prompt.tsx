/**
 * Copyable Prompt Component
 *
 * Renders a customizable button that copies text to clipboard on ctrl+y.
 * Shows visual feedback when copied.
 */

import {Text, useInput} from 'ink'
import {execSync} from 'node:child_process'
import {platform} from 'node:os'
import React, {useCallback } from 'react'

import {useTheme} from '../../hooks/index.js'

interface CopyablePromptProps {
  /** Button label/content to display */
  buttonLabel?: string
  /** Whether keyboard input is active for this component */
  isActive?: boolean
  /** The text to copy to clipboard */
  textToCopy: string
}

/**
 * Copy text to clipboard using platform-specific commands
 */
function copyToClipboard(text: string): boolean {
  try {
    const os = platform()
    if (os === 'darwin') {
      execSync('pbcopy', {input: text})
    } else if (os === 'win32') {
      execSync('clip', {input: text})
    } else {
      // Linux - try xclip first, then xsel
      try {
        execSync('xclip -selection clipboard', {input: text})
      } catch {
        execSync('xsel --clipboard --input', {input: text})
      }
    }

    return true
  } catch {
    return false
  }
}

export const CopyablePrompt: React.FC<CopyablePromptProps> = ({
  buttonLabel = 'Press ctrl+y to copy',
  isActive = true,
  textToCopy,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const handleCopy = useCallback(() => {
    copyToClipboard(textToCopy)
  }, [textToCopy])

  useInput(
    (input, key) => {
      // ctrl+y to copy
      if (key.ctrl && input === 'y') {
        handleCopy()
      }
    },
    {isActive},
  )

  return (
    <Text color={colors.dimText}>
      {buttonLabel}
    </Text>
  )
}
