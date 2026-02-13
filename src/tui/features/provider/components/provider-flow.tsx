/**
 * ProviderFlow Component
 *
 * Multi-step React flow for the /provider command.
 * State machine: loading → select → provider_actions → api_key → connecting → done
 *
 * Owns the UX flow — fetches providers, renders selection,
 * handles API key input, and calls connect/setActive mutations.
 * For connected providers, shows action menu (set active, replace key, disconnect).
 */

import {Box, Text} from 'ink'
import React, {useCallback, useMemo, useState} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {useConnectProvider} from '../api/connect-provider.js'
import {useDisconnectProvider} from '../api/disconnect-provider.js'
import {useGetProviders} from '../api/get-providers.js'
import {useSetActiveProvider} from '../api/set-active-provider.js'
import {useValidateApiKey} from '../api/validate-api-key.js'
import {ApiKeyDialog} from './api-key-dialog.js'
import {ProviderDialog} from './provider-dialog.js'

type FlowStep = 'api_key' | 'connecting' | 'done' | 'loading' | 'provider_actions' | 'select'

interface ProviderAction {
  description: string
  id: string
  name: string
}

export interface ProviderFlowProps {
  /** Whether the flow is active for keyboard input */
  isActive?: boolean
  /** Called when the flow is cancelled */
  onCancel: () => void
  /** Called when the flow completes (provider connected or switched) */
  onComplete: (message: string) => void
}

export const ProviderFlow: React.FC<ProviderFlowProps> = ({
  isActive = true,
  onCancel,
  onComplete,
}) => {
  const {theme: {colors}} = useTheme()
  const [step, setStep] = useState<FlowStep>('select')
  const [selectedProvider, setSelectedProvider] = useState<null | ProviderDTO>(null)
  const [error, setError] = useState<null | string>(null)

  const {data, isLoading} = useGetProviders()
  const connectMutation = useConnectProvider()
  const disconnectMutation = useDisconnectProvider()
  const setActiveMutation = useSetActiveProvider()
  const validateMutation = useValidateApiKey()

  const providers = data?.providers ?? []

  // Build action choices for a connected provider
  const providerActions = useMemo(() => {
    if (!selectedProvider) return []
    const actions: ProviderAction[] = []

    if (!selectedProvider.isCurrent) {
      actions.push({
        description: 'Make this the active provider',
        id: 'activate',
        name: 'Set as active',
      })
    }

    if (selectedProvider.requiresApiKey) {
      actions.push(
        {
          description: 'Enter a new API key',
          id: 'replace',
          name: 'Replace API key',
        },
        {
          description: 'Remove API key and disconnect',
          id: 'disconnect',
          name: 'Disconnect',
        },
      )
    }

    actions.push({
      description: 'Go back',
      id: 'cancel',
      name: 'Cancel',
    })

    return actions
  }, [selectedProvider])

  const handleSelect = useCallback((provider: ProviderDTO) => {
    setSelectedProvider(provider)
    setError(null)

    // Already connected — show actions menu
    if (provider.isConnected) {
      setStep('provider_actions')

      return
    }

    // Needs API key — go to api_key step
    if (provider.requiresApiKey) {
      setStep('api_key')
      return
    }

    // No API key needed — connect directly
    setStep('connecting')
    connectMutation.mutateAsync({providerId: provider.id})
      .then(() => onComplete(`Connected to ${provider.name}`))
      .catch((error_: unknown) => {
        setError(error_ instanceof Error ? error_.message : String(error_))
        setStep('select')
      })
  }, [connectMutation, onComplete])

  const handleAction = useCallback(async (action: ProviderAction) => {
    if (!selectedProvider) return

    switch (action.id) {
      case 'activate': {
        setStep('connecting')
        try {
          await setActiveMutation.mutateAsync({providerId: selectedProvider.id})
          onComplete(`Switched to ${selectedProvider.name}`)
        } catch (error_) {
          setError(error_ instanceof Error ? error_.message : String(error_))
          setStep('select')
        }

        break
      }

      case 'disconnect': {
        setStep('connecting')
        try {
          await disconnectMutation.mutateAsync({providerId: selectedProvider.id})
          onComplete(`Disconnected from ${selectedProvider.name}`)
        } catch (error_) {
          setError(error_ instanceof Error ? error_.message : String(error_))
          setStep('select')
        }

        break
      }

      case 'replace': {
        setStep('api_key')

        break
      }

      default: {
        // cancel
        setStep('select')
        setSelectedProvider(null)

        break
      }
    }
  }, [disconnectMutation, onComplete, selectedProvider, setActiveMutation])

  const handleApiKeySuccess = useCallback(async (apiKey: string) => {
    if (!selectedProvider) return

    setStep('connecting')
    try {
      await connectMutation.mutateAsync({apiKey, providerId: selectedProvider.id})
      onComplete(`Connected to ${selectedProvider.name}`)
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
      setStep('api_key')
    }
  }, [connectMutation, onComplete, selectedProvider])

  const handleApiKeyCancel = useCallback(() => {
    setStep('select')
    setSelectedProvider(null)
  }, [])

  const handleValidateApiKey = useCallback(async (apiKey: string) => {
    if (!selectedProvider) return {error: 'No provider selected', isValid: false}

    try {
      const result = await validateMutation.mutateAsync({apiKey, providerId: selectedProvider.id})
      return result
    } catch (error_) {
      return {error: error_ instanceof Error ? error_.message : String(error_), isValid: false}
    }
  }, [selectedProvider, validateMutation])

  // Loading state
  if (isLoading) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading providers...</Text>
      </Box>
    )
  }

  // Error with no providers
  if (providers.length === 0) {
    return (
      <Box>
        <Text color={colors.errorText}>No providers available.</Text>
      </Box>
    )
  }

  // Render based on current step
  switch (step) {
    case 'api_key': {
      return selectedProvider ? (
        <ApiKeyDialog
          isActive={isActive}
          onCancel={handleApiKeyCancel}
          onSuccess={handleApiKeySuccess}
          provider={selectedProvider}
          validateApiKey={handleValidateApiKey}
        />
      ) : null
    }

    case 'connecting': {
      return (
        <Box>
          <Text color={colors.primary}>
            Connecting to {selectedProvider?.name}...
          </Text>
        </Box>
      )
    }

    case 'provider_actions': {
      return selectedProvider ? (
        <Box flexDirection="column">
          {error && (
            <Box marginBottom={1}>
              <Text color={colors.errorText}>{error}</Text>
            </Box>
          )}
          <SelectableList<ProviderAction>
            filterKeys={(item) => [item.id, item.name]}
            isActive={isActive}
            items={providerActions}
            keyExtractor={(item) => item.id}
            onCancel={() => {
              setStep('select')
              setSelectedProvider(null)
            }}
            onSelect={handleAction}
            renderItem={(item, isItemActive) => (
              <Box gap={2}>
                <Text
                  backgroundColor={isItemActive ? colors.dimText : undefined}
                  color={colors.text}
                >
                  {item.name.padEnd(20)}
                </Text>
                <Text color={colors.dimText}>{item.description}</Text>
              </Box>
            )}
            title={`${selectedProvider.name} — Choose action`}
          />
        </Box>
      ) : null
    }

    case 'select': {
      return (
        <Box flexDirection="column">
          {error && (
            <Box marginBottom={1}>
              <Text color={colors.errorText}>{error}</Text>
            </Box>
          )}
          <ProviderDialog
            isActive={isActive}
            onCancel={onCancel}
            onSelect={handleSelect}
            providers={providers}
          />
        </Box>
      )
    }

    default: {
      return null
    }
  }
}
