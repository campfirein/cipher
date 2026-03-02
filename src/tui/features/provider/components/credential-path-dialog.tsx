/**
 * CredentialPathDialog Component
 *
 * Dialog for entering a file path to a service account JSON credential.
 * Used by Google Vertex AI provider which uses file-based credentials
 * instead of API keys.
 * Features:
 * - Unmasked input (file paths, not secrets)
 * - Real-time validation (file existence + JSON parse)
 * - Error message display
 * - Link to service account key page
 */

import {Box, Text, useInput} from 'ink'
import {homedir} from 'node:os'
import React, {useCallback, useState} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

import {useTheme} from '../../../hooks/index.js'
import {stripBracketedPaste} from '../../../utils/index.js'

function expandTilde(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return homedir() + filePath.slice(1)
  return filePath
}

export interface CredentialPathDialogProps {
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when credential path is successfully validated */
  onSuccess: (credentialPath: string) => void
  /** The provider to connect to */
  provider: ProviderDTO
  /** Optional validation function */
  validateCredential?: (path: string, provider: ProviderDTO) => Promise<{error?: string; isValid: boolean}>
}

const defaultValidate = async (): Promise<{error?: string; isValid: boolean}> => ({isValid: true})

export const CredentialPathDialog: React.FC<CredentialPathDialogProps> = ({
  isActive = true,
  onCancel,
  onSuccess,
  provider,
  validateCredential = defaultValidate,
}) => {
  const {theme: {colors}} = useTheme()
  const [filePath, setFilePath] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const handleSubmit = useCallback(async () => {
    if (!filePath.trim()) {
      setError('File path is required')
      return
    }

    const resolvedPath = expandTilde(filePath.trim())
    setIsValidating(true)
    setError(undefined)

    try {
      const result = await validateCredential(resolvedPath, provider)
      if (result.isValid) {
        onSuccess(resolvedPath)
      } else {
        setError(result.error ?? 'Invalid credential file')
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Validation failed')
    } finally {
      setIsValidating(false)
    }
  }, [filePath, provider, validateCredential, onSuccess])

  useInput(
    (input, key) => {
      if (key.return && !isValidating) {
        handleSubmit()
        return
      }

      if (key.escape) {
        if (filePath.length > 0) {
          setFilePath('')
          setError(undefined)
        } else {
          onCancel()
        }

        return
      }

      if (key.backspace || key.delete) {
        setFilePath((prev) => prev.slice(0, -1))
        setError(undefined)
        return
      }

      if (input && !key.ctrl && !key.meta) {
        const cleaned = stripBracketedPaste(input)
        if (cleaned) {
          setFilePath((prev) => prev + cleaned)
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
          Connect to {provider.name}
        </Text>
      </Box>

      {/* Link */}
      {provider.apiKeyUrl && (
        <Box marginBottom={1}>
          <Text color={colors.dimText}>
            Get your service account key at:{' '}
          </Text>
          <Text color={colors.dimText} underline>
            {provider.apiKeyUrl}
          </Text>
        </Box>
      )}

      {/* Input field / Validating status */}
      <Box marginBottom={1}>
        {isValidating ? (
          <Text color={colors.primary}>⟳ Validating...</Text>
        ) : (
          <Box>
            <Box flexShrink={0}>
              <Text color={colors.primary}>
                Service account JSON key file path:{' '}
              </Text>
            </Box>
            <Box>
              <Text>
                <Text color={filePath ? colors.text : colors.dimText}>
                  {filePath || '/path/to/service-account.json'}
                </Text>
                {filePath && <Text color={colors.primary}>▎</Text>}
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Error */}
      <Box marginBottom={1}>
        {error && !isValidating && (
          <Text color={colors.warning}>
            ✗ {error}
          </Text>
        )}
      </Box>

      {/* Keybind hints */}
      {!isValidating && (
        <Box gap={2}>
          <Text color={colors.dimText}>
            <Text color={colors.text}>Enter</Text> Submit
          </Text>
          <Text color={colors.dimText}>
            <Text color={colors.text}>Esc</Text> {filePath.length > 0 ? 'Clear' : 'Cancel'}
          </Text>
        </Box>
      )}
    </Box>
  )
}
