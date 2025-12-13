/**
 * InlineInput Component
 *
 * Generic inline text input prompt with validation.
 * Shows validation errors below input.
 * User types and presses Enter to submit.
 */

import {Box, Text} from 'ink'
import TextInput from 'ink-text-input'
import React, {useState} from 'react'

import {useTheme} from '../../hooks/index.js'

export interface InlineInputProps {
  /** The prompt message */
  message: string
  /** Callback when user submits valid input */
  onSubmit: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Validation function - return true if valid, or error message string */
  validate?: (value: string) => boolean | string
}

export function InlineInput({
  message,
  onSubmit,
  placeholder,
  validate,
}: InlineInputProps): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [value, setValue] = useState('')
  const [error, setError] = useState<null | string>(null)

  const handleSubmit = (inputValue: string) => {
    // Clear previous error
    setError(null)

    // Run validation if provided
    if (validate) {
      const result = validate(inputValue)
      if (result !== true) {
        setError(typeof result === 'string' ? result : 'Invalid input')
        return
      }
    }

    // Submit valid input
    onSubmit(inputValue)
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.secondary}>? </Text>
        <Text color={colors.text}>{message} </Text>
        <TextInput
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          value={value}
        />
      </Box>
      {error && (
        <Box marginLeft={2}>
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
    </Box>
  )
}
