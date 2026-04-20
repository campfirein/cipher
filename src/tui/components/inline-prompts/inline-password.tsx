/**
 * InlinePassword Component
 *
 * Masked-input variant of InlineInput for secrets (e.g., SSH key passphrases).
 *
 * Renders `*` for each typed character; the real value is never written to
 * the Ink text stream. Uses ink's useInput directly (same rationale as
 * InlineInput — paste chunks arriving in a single React batch must
 * accumulate via a functional state updater).
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useState} from 'react'

import {useTheme} from '../../hooks/index.js'
import {stripBracketedPaste} from '../../utils/index.js'

export interface InlinePasswordProps {
  /** The prompt message shown before the masked field */
  message: string
  /** Escape-key handler (caller typically aborts the surrounding flow) */
  onCancel?: () => void
  /** Called with the raw (unmasked) value when user presses Enter */
  onSubmit: (value: string) => void
}

export function InlinePassword({
  message,
  onCancel,
  onSubmit,
}: InlinePasswordProps): React.ReactElement {
  const {
    theme: {colors},
  } = useTheme()
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(() => {
    setValue((currentValue) => {
      const cleaned = stripBracketedPaste(currentValue)
      // Empty passphrase is almost always a mistake; do not submit.
      if (cleaned.length === 0) return currentValue
      setTimeout(() => onSubmit(cleaned), 0)
      return currentValue
    })
  }, [onSubmit])

  useInput((input, key) => {
    if (key.escape) {
      if (onCancel) onCancel()
      return
    }

    if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab)) {
      return
    }

    if (key.return) {
      handleSubmit()
      return
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1))
      return
    }

    if (input && !key.ctrl && !key.meta) {
      const cleaned = stripBracketedPaste(input)
      if (cleaned) {
        setValue((prev) => prev + cleaned)
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.secondary}>? </Text>
        <Text color={colors.text}>{message} </Text>
        <Text color={colors.text}>{'*'.repeat(value.length)}</Text>
      </Box>
    </Box>
  )
}
