/**
 * ProviderFlow Component
 *
 * Multi-step React flow for the /providers command.
 * State machine: loading → select → login_prompt → login → provider_actions → api_key → connecting → done
 *
 * Owns the UX flow — fetches providers, renders selection,
 * handles API key input, and calls connect/setActive mutations.
 * For connected providers, shows action menu (set active, replace key, disconnect).
 */

import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'
import type {CommandSideEffects} from '../../../types/commands.js'

import {InlineConfirm} from '../../../components/inline-prompts/inline-confirm.js'
import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {formatTransportError} from '../../../utils/index.js'
import {LoginFlow} from '../../auth/components/login-flow.js'
import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useConnectProvider} from '../api/connect-provider.js'
import {useDisconnectProvider} from '../api/disconnect-provider.js'
import {useGetProviders} from '../api/get-providers.js'
import {useSetActiveProvider} from '../api/set-active-provider.js'
import {useValidateApiKey} from '../api/validate-api-key.js'
import {ApiKeyDialog} from './api-key-dialog.js'
import {AuthMethodDialog} from './auth-method-dialog.js'
import {BaseUrlDialog} from './base-url-dialog.js'
import {ModelSelectStep} from './model-select-step.js'
import {OAuthDialog} from './oauth-dialog.js'
import {ProviderDialog} from './provider-dialog.js'

type FlowStep = 'api_key' | 'auth_method' | 'base_url' | 'connecting' | 'done' | 'loading' | 'login' | 'login_prompt' | 'model_select' | 'oauth' | 'provider_actions' | 'select'

interface ProviderAction {
  description: string
  id: string
  name: string
}

export interface ProviderFlowProps {
  /** Hide the Cancel keybind in provider selection */
  hideCancelButton?: boolean
  /** Whether the flow is active for keyboard input */
  isActive?: boolean
  /** Called when the flow is cancelled */
  onCancel: () => void
  /** Called when the flow completes (provider connected or switched) */
  onComplete: (message: string, sideEffects?: CommandSideEffects) => void
  /** Custom title for the provider selection dialog */
  providerDialogTitle?: string
}

export const ProviderFlow: React.FC<ProviderFlowProps> = ({
  hideCancelButton = false,
  isActive = true,
  onCancel,
  onComplete,
  providerDialogTitle,
}) => {
  const {theme: {colors}} = useTheme()
  const [step, setStep] = useState<FlowStep>('select')
  const [selectedProvider, setSelectedProvider] = useState<null | ProviderDTO>(null)
  const [baseUrl, setBaseUrl] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)

  const {data, isError: isProvidersError, isLoading} = useGetProviders()
  const connectMutation = useConnectProvider()
  const disconnectMutation = useDisconnectProvider()
  const setActiveMutation = useSetActiveProvider()
  const validateMutation = useValidateApiKey()
  const isAuthorized = useAuthStore((s) => s.isAuthorized)

  const providers = data?.providers ?? []

  // Exit gracefully when providers query fails — don't leave user stuck
  useEffect(() => {
    if (isProvidersError) {
      onComplete('Failed to load providers. Check your connection and try again.')
    }
  }, [isProvidersError, onComplete])

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

    if (selectedProvider.authMethod === 'oauth') {
      actions.push(
        {
          description: 'Re-authenticate via browser',
          id: 'reconnect_oauth',
          name: 'Reconnect OAuth',
        },
        {
          description: 'Remove OAuth connection',
          id: 'disconnect',
          name: 'Disconnect',
        },
      )
    } else if (selectedProvider.requiresApiKey) {
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

    if (selectedProvider.id === 'openai-compatible') {
      actions.push(
        {
          description: 'Change base URL and API key',
          id: 'reconfigure',
          name: 'Reconfigure',
        },
        {
          description: 'Remove configuration and disconnect',
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

  const handleSelect = useCallback(async (provider: ProviderDTO) => {
    setSelectedProvider(provider)
    setError(null)

    // ByteRover requires authentication
    if (provider.id === 'byterover' && !isAuthorized) {
      setStep('login_prompt')
      return
    }

    // ByteRover + already active → complete
    if (provider.id === 'byterover' && provider.isCurrent) {
      onComplete(`Connected to ${provider.name}`)
      return
    }

    // Already connected → show actions menu
    if (provider.isConnected) {
      setStep('provider_actions')
      return
    }

    // ByteRover + not connected → connect + activate directly, no model select
    if (provider.id === 'byterover') {
      setStep('connecting')
      try {
        await connectMutation.mutateAsync({providerId: provider.id})
        await setActiveMutation.mutateAsync({providerId: provider.id})
        onComplete(`Connected to ${provider.name}`)
      } catch (error_) {
        setError(formatTransportError(error_))
        setStep('select')
      }

      return
    }

    // OpenAI Compatible → base_url step
    if (provider.id === 'openai-compatible') {
      setStep('base_url')
      return
    }

    // Supports OAuth → auth method selection
    if (provider.supportsOAuth) {
      setStep('auth_method')
      return
    }

    // Requires API key → api_key step
    if (provider.requiresApiKey) {
      setStep('api_key')
      return
    }

    // No API key needed → connect directly → model select
    setStep('connecting')
    try {
      await connectMutation.mutateAsync({providerId: provider.id})
      setStep('model_select')
    } catch (error_) {
      setError(formatTransportError(error_))
      setStep('select')
    }
  }, [connectMutation, isAuthorized, onComplete, setActiveMutation])

  const handleAction = useCallback(async (action: ProviderAction) => {
    if (!selectedProvider) return

    switch (action.id) {
      case 'activate': {
        if (selectedProvider.id === 'byterover' && !isAuthorized) {
          setStep('login_prompt')
          return
        }

        setStep('connecting')
        try {
          await setActiveMutation.mutateAsync({providerId: selectedProvider.id})
          if (selectedProvider.id === 'byterover') {
            onComplete(`Switched to ${selectedProvider.name}`)
          } else {
            setStep('model_select')
          }
        } catch (error_) {
          setError(formatTransportError(error_))
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
          setError(formatTransportError(error_))
          setStep('select')
        }

        break
      }

      case 'reconfigure': {
        setStep('base_url')

        break
      }

      case 'reconnect_oauth': {
        setStep('oauth')

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
  }, [disconnectMutation, isAuthorized, onComplete, selectedProvider, setActiveMutation])

  const handleLoginComplete = useCallback((message: string) => {
    const nowAuthorized = useAuthStore.getState().isAuthorized
    if (!nowAuthorized) {
      setError(message)
    }

    setStep('select')
  }, [])

  const handleBaseUrlSubmit = useCallback((url: string) => {
    setBaseUrl(url)
    setStep('api_key')
  }, [])

  const handleApiKeySuccess = useCallback(async (apiKey: string) => {
    if (!selectedProvider) return

    setStep('connecting')
    try {
      await connectMutation.mutateAsync({
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        providerId: selectedProvider.id,
      })
      setStep('model_select')
    } catch (error_) {
      setError(formatTransportError(error_))
      setStep('api_key')
    }
  }, [baseUrl, connectMutation, selectedProvider])

  const handleApiKeyCancel = useCallback(() => {
    if (selectedProvider?.supportsOAuth) {
      setStep('auth_method')
    } else {
      setStep('select')
      setSelectedProvider(null)
      setBaseUrl(null)
    }
  }, [selectedProvider])

  const handleAuthMethodSelect = useCallback((method: 'api-key' | 'oauth') => {
    if (method === 'oauth') {
      setStep('oauth')
    } else {
      setStep('api_key')
    }
  }, [])

  const handleOAuthCancel = useCallback(() => {
    setStep('auth_method')
  }, [])

  const handleOAuthSuccess = useCallback(() => {
    setStep('model_select')
  }, [])

  const handleValidateApiKey = useCallback(async (apiKey: string) => {
    if (!selectedProvider) return {error: 'No provider selected', isValid: false}

    // Skip server-side validation for openai-compatible (baseUrl not stored yet)
    if (selectedProvider.id === 'openai-compatible') {
      return {isValid: true}
    }

    try {
      const result = await validateMutation.mutateAsync({apiKey, providerId: selectedProvider.id})
      return result
    } catch (error_) {
      return {error: formatTransportError(error_), isValid: false}
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
        <Text color={colors.warning}>No providers available.</Text>
      </Box>
    )
  }

  // Render based on current step
  switch (step) {
    case 'api_key': {
      return selectedProvider ? (
        <ApiKeyDialog
          isActive={isActive}
          isOptional={selectedProvider.id === 'openai-compatible'}
          onCancel={handleApiKeyCancel}
          onSuccess={handleApiKeySuccess}
          provider={selectedProvider}
          validateApiKey={handleValidateApiKey}
        />
      ) : null
    }

    case 'auth_method': {
      return selectedProvider ? (
        <AuthMethodDialog
          isActive={isActive}
          onCancel={() => {
            setStep('select')
            setSelectedProvider(null)
          }}
          onSelect={handleAuthMethodSelect}
          provider={selectedProvider}
        />
      ) : null
    }

    case 'base_url': {
      return (
        <BaseUrlDialog
          description="Enter the base URL of your OpenAI-compatible endpoint (Ollama, LM Studio, etc.)"
          isActive={isActive}
          onCancel={handleApiKeyCancel}
          onSubmit={handleBaseUrlSubmit}
          title="Connect to OpenAI Compatible"
        />
      )
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

    case 'login': {
      return (
        <LoginFlow
          onCancel={() => {}}
          onComplete={handleLoginComplete}
        />
      )
    }

    case 'login_prompt': {
      return (
        <InlineConfirm
          default={true}
          message="ByteRover requires authentication. Sign in now"
          onConfirm={(confirmed) => {
            if (confirmed) {
              setStep('login')
            } else {
              setStep('select')
              setSelectedProvider(null)
            }
          }}
        />
      )
    }

    case 'model_select': {
      return selectedProvider ? (
        <ModelSelectStep
          isActive={isActive}
          onCancel={() => setStep('select')}
          onComplete={(modelName) => onComplete(`Connected to ${selectedProvider.name}, model set to ${modelName}`)}
          providerId={selectedProvider.id}
          providerName={selectedProvider.name}
        />
      ) : null
    }

    case 'oauth': {
      return selectedProvider ? (
        <OAuthDialog
          isActive={isActive}
          onCancel={handleOAuthCancel}
          onSuccess={handleOAuthSuccess}
          provider={selectedProvider}
        />
      ) : null
    }

    case 'provider_actions': {
      return selectedProvider ? (
        <Box flexDirection="column">
          {error && (
            <Box marginBottom={1}>
              <Text color={colors.warning}>{error}</Text>
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
              <Text color={colors.warning}>{error}</Text>
            </Box>
          )}
          <ProviderDialog
            hideCancelButton={hideCancelButton}
            isActive={isActive}
            onCancel={onCancel}
            onSelect={handleSelect}
            providers={providers}
            title={providerDialogTitle}
          />
        </Box>
      )
    }

    default: {
      return null
    }
  }
}
