/**
 * InlineConfirm Component
 *
 * Generic inline yes/no confirmation prompt.
 * Shows (Y/n) or (N/y) based on default value.
 * User types y/n and presses Enter to submit.
 */

import {Box, Text, useInput} from 'ink'
import TextInput from 'ink-text-input'
import React, {useState} from 'react'

import {useTheme} from '../../hooks/index.js'

export interface InlineConfirmProps {
  /** Default value (default: true = Yes) */
  default?: boolean
  /** The prompt message */
  message: string
  /** Callback when user confirms or cancels */
  onConfirm: (value: boolean) => void
}

export function InlineConfirm({
  default: defaultValue = true,
  message,
  onConfirm,
}: InlineConfirmProps): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [input, setInput] = useState('')

  useInput((_input, key) => {
    if (key.escape) {
      onConfirm(false)
    }
  })

  // Format hint based on default: (Y/n) or (N/y)
  const hint = defaultValue ? '(Y/n)' : '(N/y)'

  const handleSubmit = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'y' || trimmed === 'yes') {
      onConfirm(true)
    } else if (trimmed === 'n' || trimmed === 'no') {
      onConfirm(false)
    } else {
      // Empty or invalid input uses default
      onConfirm(defaultValue)
    }
  }

  return (
    <Box>
      <Text color={colors.text}>
        {message}?
        {' '}
        <Text color={colors.secondary}>{hint} </Text>
        <TextInput onChange={setInput} onSubmit={handleSubmit} value={input} />
      </Text>
    </Box>
  )
}
