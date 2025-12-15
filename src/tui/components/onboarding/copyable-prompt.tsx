/**
 * Copyable Prompt Component
 *
 * Displays a bordered prompt with keyboard shortcut to copy to clipboard.
 * Shows visual feedback when copied.
 */

import {Box, Text, useInput} from 'ink'
import {execSync} from 'node:child_process'
import {platform} from 'node:os'
import React, {useCallback, useEffect, useState} from 'react'

import {useTheme} from '../../hooks/index.js'

interface CopyablePromptProps {
  /** Whether keyboard input is active for this component */
  isActive?: boolean
  /** The prompt text to display and copy */
  prompt: string
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

export const CopyablePrompt: React.FC<CopyablePromptProps> = ({isActive = true, prompt}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [copied, setCopied] = useState(false)

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => {
        setCopied(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [copied])

  const handleCopy = useCallback(() => {
    const success = copyToClipboard(prompt)
    if (success) {
      setCopied(true)
    }
  }, [prompt])

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
    <Box flexDirection="column">
      <Box borderColor={colors.border} borderStyle="round" paddingX={1}>
        <Text>{prompt}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.dimText}>
          Press{' '}
          <Text backgroundColor={colors.primary} color="black">
            {' ctrl+y '}
          </Text>{' '}
          to copy
        </Text>
        {copied && <Text color={colors.secondary}> Copied!</Text>}
      </Box>
    </Box>
  )
}
