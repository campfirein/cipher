/**
 * BaseUrlDialog Component
 *
 * Reusable dialog for entering and validating a base URL.
 * Title and description are provided via props.
 * Features:
 * - URL format validation (must be http:// or https://)
 * - Strips trailing slashes
 * - Error message display
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useState} from 'react'

import {useTheme} from '../../../hooks/index.js'
import {stripBracketedPaste} from '../../../utils/index.js'

export interface BaseUrlDialogProps {
  /** Description text shown below the title */
  description: string
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when a valid base URL is submitted */
  onSubmit: (baseUrl: string) => void
  /** Title displayed at the top of the dialog */
  title: string
}

/**
 * Validates a URL string. Must be a valid http:// or https:// URL.
 * Returns an error message string if invalid, or undefined if valid.
 */
function validateUrl(input: string): string | undefined {
  if (!input) {
    return 'Base URL is required'
  }

  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with http:// or https://'
    }

    return undefined
  } catch {
    return 'Invalid URL format'
  }
}

export const BaseUrlDialog: React.FC<BaseUrlDialogProps> = ({
  description,
  isActive = true,
  onCancel,
  onSubmit,
  title,
}) => {
  const {theme: {colors}} = useTheme()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | undefined>()

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim().replace(/\/+$/, '')
    const validationError = validateUrl(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }

    onSubmit(trimmed)
  }, [url, onSubmit])

  useInput(
    (input, key) => {
      if (key.return) {
        handleSubmit()
        return
      }

      if (key.escape) {
        if (url.length > 0) {
          setUrl('')
          setError(undefined)
        } else {
          onCancel()
        }

        return
      }

      if (key.backspace || key.delete) {
        setUrl((prev) => prev.slice(0, -1))
        setError(undefined)
        return
      }

      if (input && !key.ctrl && !key.meta) {
        const cleaned = stripBracketedPaste(input)
        if (cleaned) {
          setUrl((prev) => prev + cleaned)
          setError(undefined)
        }
      }
    },
    {isActive},
  )

  return (
    <Box
      borderColor={colors.border}
      borderStyle="single"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color={colors.text}>
          {title}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text color={colors.dimText}>
          {description}
        </Text>
      </Box>

      {/* Input field */}
      <Box marginBottom={1}>
        <Box flexShrink={0}>
          <Text color={colors.primary}>
            Base URL:{' '}
          </Text>
        </Box>
        <Box>
          <Text>
            <Text color={url ? colors.text : colors.dimText}>
              {url || 'http://localhost:11434/v1'}
            </Text>
            {url && <Text color={colors.primary}>▎</Text>}
          </Text>
        </Box>
      </Box>

      {/* Error */}
      <Box marginBottom={1}>
        {error && (
          <Text color={colors.warning}>
            ✗ {error}
          </Text>
        )}
      </Box>

      {/* Keybind hints */}
      <Box gap={2}>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Enter</Text> Submit
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Esc</Text> {url.length > 0 ? 'Clear' : 'Cancel'}
        </Text>
      </Box>
    </Box>
  )
}
