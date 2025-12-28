/**
 * Copyable Prompt Component
 *
 * Renders a customizable button that copies text to clipboard on ctrl+y.
 * Shows visual feedback when copied.
 */

import {Text, useInput} from 'ink'
import {execSync} from 'node:child_process'
import {platform} from 'node:os'
import React, {useCallback, useEffect, useState} from 'react'

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
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => {
        setCopied(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [copied])

  const handleCopy = useCallback(() => {
    const success = copyToClipboard(textToCopy)
    if (success) {
      setCopied(true)
    }
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
    <Text color={copied ? colors.primary : colors.dimText}>
      {copied ? "Copied!" : buttonLabel}
    </Text>
  )
}
