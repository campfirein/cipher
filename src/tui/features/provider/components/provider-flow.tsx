/**
 * ProviderFlow Component
 *
 * Multi-step React flow for the /provider command.
 * State machine: loading → select → api_key → connecting → done
 *
 * Owns the UX flow — fetches providers, renders selection,
 * handles API key input, and calls connect/setActive mutations.
 */

import {Box, Text, useInput} from 'ink'
import React, {useCallback, useState} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'
import type {CommandSideEffects} from '../../../types/commands.js'

import {useOnboarding, useTheme} from '../../../hooks/index.js'
import {LoginFlow} from '../../auth/components/login-flow.js'
import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useConnectProvider} from '../api/connect-provider.js'
import {useGetProviders} from '../api/get-providers.js'
import {useSetActiveProvider} from '../api/set-active-provider.js'
import {useValidateApiKey} from '../api/validate-api-key.js'
import {ApiKeyDialog} from './api-key-dialog.js'
import {ProviderDialog} from './provider-dialog.js'

type FlowStep = 'api_key' | 'connecting' | 'done' | 'loading' | 'login' | 'login_prompt' | 'select'

export interface ProviderFlowProps {
  /** Whether the flow is active for keyboard input */
  isActive?: boolean
  /** Called when the flow is cancelled */
  onCancel: () => void
  /** Called when the flow completes (provider connected or switched) */
  onComplete: (message: string, sideEffects?: CommandSideEffects) => void
}

export const ProviderFlow: React.FC<ProviderFlowProps> = ({
  isActive = true,
  onCancel,
  onComplete,
}) => {
  const {theme: {colors}} = useTheme()
  const {viewMode} = useOnboarding()
  const isInitingProvider = viewMode.type === 'onboarding' && viewMode.step === 'initing-provider'
  const [step, setStep] = useState<FlowStep>('select')
  const [selectedProvider, setSelectedProvider] = useState<null | ProviderDTO>(null)
  const [error, setError] = useState<null | string>(null)
  const isAuthorized = useAuthStore((s) => s.isAuthorized)

  const {data, isLoading} = useGetProviders()
  const connectMutation = useConnectProvider()
  const setActiveMutation = useSetActiveProvider()
  const validateMutation = useValidateApiKey()

  const providers = data?.providers ?? []

  const completeFlow = useCallback((message: string) => {
    const sideEffects: CommandSideEffects | undefined = isInitingProvider ? {completeInitProvider: true} : undefined
    onComplete(message, sideEffects)
  }, [isInitingProvider, onComplete])

  const handleLoginComplete = useCallback(async () => {
    if (!useAuthStore.getState().isAuthorized) {
      setError('Authentication failed. Please try again.')
      setStep('select')
      return
    }

    setStep('connecting')
    try {
      await connectMutation.mutateAsync({providerId: 'byterover'})
      completeFlow('Connected to ByteRover')
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
      setStep('select')
    }
  }, [completeFlow, connectMutation])

  const handleSelect = useCallback(async (provider: ProviderDTO) => {
    if (provider.id === 'byterover' && !isAuthorized) {
      setSelectedProvider(provider)
      setStep('login_prompt')
      return
    }

    setSelectedProvider(provider)
    setError(null)

    // Already connected — just switch to it
    if (provider.isConnected) {
      setStep('connecting')
      try {
        await setActiveMutation.mutateAsync({providerId: provider.id})
        completeFlow(`Switched to ${provider.name}`)
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_))
        setStep('select')
      }

      return
    }

    // Needs API key — go to api_key step
    if (provider.requiresApiKey) {
      setStep('api_key')
      return
    }

    // No API key needed — connect directly
    setStep('connecting')
    try {
      await connectMutation.mutateAsync({providerId: provider.id})
      completeFlow(`Connected to ${provider.name}`)
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
      setStep('select')
    }
  }, [connectMutation, isAuthorized, completeFlow, setActiveMutation])

  const handleApiKeySuccess = useCallback(async (apiKey: string) => {
    if (!selectedProvider) return

    setStep('connecting')
    try {
      await connectMutation.mutateAsync({apiKey, providerId: selectedProvider.id})
      completeFlow(`Connected to ${selectedProvider.name}`)
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
      setStep('api_key')
    }
  }, [completeFlow, connectMutation, selectedProvider])

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

  // Handle Enter/Esc on login prompt step
  useInput((_input, key) => {
    if (key.return) setStep('login')
    if (key.escape) setStep('select')
  }, {isActive: isActive && step === 'login_prompt'})

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

    case 'login': {
      return <LoginFlow onCancel={() => setStep('select')} onComplete={handleLoginComplete} />
    }

    case 'login_prompt': {
      return (
        <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
          <Box marginBottom={1}>
            <Text bold color={colors.text}>ByteRover provider requires authentication to use.</Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text color={colors.text}>  · $5 free credit on sign-up (one-time)</Text>
            <Text color={colors.text}>  · Pay-per-token usage (input & output)</Text>
            <Text color={colors.text}>  · No monthly reset — credit never expires</Text>
            <Text color={colors.text}>  · Access pauses when balance reaches $0</Text>
          </Box>
          <Box gap={2}>
            <Text color={colors.dimText}>
              <Text color={colors.text}>Enter</Text> Log in
            </Text>
            <Text color={colors.dimText}>
              <Text color={colors.text}>Esc</Text> Back
            </Text>
          </Box>
        </Box>
      )
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
