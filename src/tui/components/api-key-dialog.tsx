/**
 * ApiKeyDialog Component
 *
 * Dialog for entering and validating API keys for LLM providers.
 * Features:
 * - Masked input option (toggle with Ctrl+M)
 * - Real-time validation
 * - Loading state during validation
 * - Error message display
 * - Link to get API key
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useState} from 'react'

import type {ProviderDefinition} from '../../core/domain/entities/provider-registry.js'

import {useTheme} from '../contexts/theme-context.js'

/**
 * Validation result from API key check.
 */
export interface ApiKeyValidationResult {
  error?: string
  isValid: boolean
}

/**
 * Props for ApiKeyDialog.
 */
export interface ApiKeyDialogProps {
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when API key is successfully validated */
  onSuccess: (apiKey: string) => void
  /** The provider to connect to */
  provider: ProviderDefinition
  /** Optional validation function - should call the provider's API to verify key */
  validateApiKey?: (apiKey: string, provider: ProviderDefinition) => Promise<ApiKeyValidationResult>
}

/**
 * Masks an API key, showing only the last 4 characters.
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return '*'.repeat(apiKey.length)
  }

  return '*'.repeat(apiKey.length - 4) + apiKey.slice(-4)
}

/**
 * Default validation function - always returns valid.
 * In production, this should be replaced with actual API validation.
 */
const defaultValidateApiKey = async (): Promise<ApiKeyValidationResult> => ({isValid: true})

/**
 * ApiKeyDialog displays an input for entering and validating API keys.
 */
export const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({
  isActive = true,
  onCancel,
  onSuccess,
  provider,
  validateApiKey = defaultValidateApiKey,
}) => {
  const {theme: {colors}} = useTheme()
  const [apiKey, setApiKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [showMasked, setShowMasked] = useState(true)

  const handleSubmit = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('API key is required')
      return
    }

    setIsValidating(true)
    setError(undefined)

    try {
      const result = await validateApiKey(apiKey.trim(), provider)
      if (result.isValid) {
        onSuccess(apiKey.trim())
      } else {
        setError(result.error ?? 'Invalid API key')
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Validation failed')
    } finally {
      setIsValidating(false)
    }
  }, [apiKey, provider, validateApiKey, onSuccess])

  // Handle keyboard input for text entry and commands
  useInput(
    (input, key) => {
      // Submit on Enter
      if (key.return && !isValidating) {
        handleSubmit()
        return
      }

      // Cancel on Escape
      if (key.escape) {
        onCancel()
        return
      }

      // Toggle mask with Ctrl+M
      if (input === 'm' && key.ctrl) {
        setShowMasked((prev) => !prev)
        return
      }

      // Handle backspace
      if (key.backspace || key.delete) {
        setApiKey((prev) => prev.slice(0, -1))
        setError(undefined)
        return
      }

      // Handle printable characters (type to add to API key)
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setApiKey((prev) => prev + input)
        setError(undefined)
      }
    },
    {isActive},
  )

  // Display value based on mask state
  const displayValue = showMasked ? maskApiKey(apiKey) : apiKey

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
          Connect to {provider.name}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text color={colors.dimText}>
          Enter your {provider.name} API key:
        </Text>
      </Box>

      {/* Input field */}
      <Box
        borderColor={error ? colors.errorText : colors.border}
        borderStyle="single"
        marginBottom={1}
        paddingX={1}
      >
        <Text color={apiKey ? colors.text : colors.dimText}>
          {apiKey ? displayValue : 'sk-or-v1-...'}
        </Text>
        <Text color={colors.primary}>▎</Text>
      </Box>

      {/* API key link */}
      {provider.apiKeyUrl && (
        <Box marginBottom={1}>
          <Text color={colors.dimText}>
            Get your API key at:{' '}
          </Text>
          <Text color={colors.primary} underline>
            {provider.apiKeyUrl}
          </Text>
        </Box>
      )}

      {/* Status */}
      <Box marginBottom={1}>
        {isValidating && (
          <Text color={colors.primary}>
            ⟳ Validating...
          </Text>
        )}
        {error && !isValidating && (
          <Text color={colors.errorText}>
            ✗ {error}
          </Text>
        )}
        {!isValidating && !error && apiKey.length > 0 && (
          <Text color={colors.dimText}>
            Press Enter to validate
          </Text>
        )}
      </Box>

      {/* Keybind hints */}
      <Box gap={2}>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Enter</Text> Submit
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Esc</Text> Cancel
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Ctrl+M</Text> {showMasked ? 'Show' : 'Hide'}
        </Text>
      </Box>
    </Box>
  )
}
