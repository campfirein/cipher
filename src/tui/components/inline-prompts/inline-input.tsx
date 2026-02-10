/**
 * InlineInput Component
 *
 * Generic inline text input prompt with validation.
 * Shows validation errors below input.
 * User types and presses Enter to submit.
 *
 * Uses ink's useInput directly (instead of ink-text-input) to correctly
 * handle pasted text. When paste arrives in multiple stdin chunks within
 * the same React batch, ink-text-input's state-based approach drops middle
 * chunks. Using a functional state updater (prev => prev + cleaned) ensures
 * all chunks are accumulated correctly.
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useState} from 'react'

import {useTheme} from '../../hooks/index.js'
import {stripBracketedPaste} from '../../utils/index.js'

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

  const handleSubmit = useCallback(() => {
    // Read current value via functional updater to get latest state
    setValue((currentValue) => {
      const cleaned = stripBracketedPaste(currentValue).trim()

      // Clear previous error
      setError(null)

      // Run validation if provided
      if (validate) {
        const result = validate(cleaned)
        if (result !== true) {
          setError(typeof result === 'string' ? result : 'Invalid input')

          return currentValue
        }
      }

      // Submit valid input (deferred to avoid setState-during-render)
      setTimeout(() => onSubmit(cleaned), 0)

      return currentValue
    })
  }, [onSubmit, validate])

  useInput((input, key) => {
    // Ignore navigation and control keys
    if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab)) {
      return
    }

    // Submit on Enter
    if (key.return) {
      handleSubmit()

      return
    }

    // Handle backspace/delete
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1))
      setError(null)

      return
    }

    // Handle printable characters (type or paste)
    if (input && !key.ctrl && !key.meta) {
      const cleaned = stripBracketedPaste(input)
      if (cleaned) {
        // Functional updater ensures correct accumulation during React batching
        setValue((prev) => prev + cleaned)
        setError(null)
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.secondary}>? </Text>
        <Text color={colors.text}>{message} </Text>
        <Text color={value ? colors.text : colors.dimText}>{value || placeholder || ''}</Text>
      </Box>
      {error && (
        <Box marginLeft={2}>
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
    </Box>
  )
}
