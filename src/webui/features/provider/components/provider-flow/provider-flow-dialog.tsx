import { Dialog, DialogContent } from '@campfirein/byterover-packages/components/dialog'
import { LoaderCircle } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import type {ModelDTO, ProviderDTO} from '../../../../../shared/transport/events'

import { formatError } from '../../../../lib/error-messages'
import { useSetActiveModel } from '../../../model/api/set-active-model'
import {TourStepBadge} from '../../../onboarding/components/tour-step-badge'
import { useAwaitOAuthCallback } from '../../api/await-oauth-callback'
import { useConnectProvider } from '../../api/connect-provider'
import { useDisconnectProvider } from '../../api/disconnect-provider'
import { useGetProviders } from '../../api/get-providers'
import { useSetActiveProvider } from '../../api/set-active-provider'
import { useStartOAuth } from '../../api/start-oauth'
import { useValidateApiKey } from '../../api/validate-api-key'
import { ApiKeyStep } from './api-key-step'
import { AuthMethodStep } from './auth-method-step'
import { BaseUrlStep } from './base-url-step'
import { ModelSelectStep } from './model-select-step'
import { type ProviderActionId, ProviderActionStep } from './provider-action-step'
import { ProviderSelectStep } from './provider-select-step'

type FlowStep = 'api_key' | 'auth_method' | 'base_url' | 'connecting' | 'model_select' | 'provider_actions' | 'select'

interface ProviderFlowDialogProps {
  onOpenChange: (open: boolean) => void
  /**
   * Fires when a provider becomes the active one (direct activation, model
   * selected after a fresh connection, or the existing provider re-activated).
   * The dialog still closes itself afterwards via onOpenChange — this is just
   * a discriminator for callers that need to distinguish "success" from
   * "dismissed", e.g. the onboarding tour.
   */
  onProviderActivated?: () => void
  open: boolean
  /** When set, shows a "Step N of M" pill above the dialog content (tour mode). */
  tourStepLabel?: string
}

export function ProviderFlowDialog({onOpenChange, onProviderActivated, open, tourStepLabel}: ProviderFlowDialogProps) {
  const [step, setStep] = useState<FlowStep>('select')
  const [selectedProvider, setSelectedProvider] = useState<ProviderDTO | undefined>()
  const [baseUrl, setBaseUrl] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [isNewConnection, setIsNewConnection] = useState(false)

  const {data} = useGetProviders()
  const connectMutation = useConnectProvider()
  const disconnectMutation = useDisconnectProvider()
  const setActiveMutation = useSetActiveProvider()
  const validateMutation = useValidateApiKey()
  const startOAuthMutation = useStartOAuth()
  const awaitOAuthMutation = useAwaitOAuthCallback()
  const setActiveModelMutation = useSetActiveModel()

  const providers = data?.providers ?? []

  const reset = useCallback(() => {
    setStep('select')
    setSelectedProvider(undefined)
    setBaseUrl(undefined)
    setError(undefined)
    setIsNewConnection(false)
  }, [])

  const resetAndClose = useCallback(() => {
    onOpenChange(false)
    // Delay reset until close animation finishes
    setTimeout(reset, 150)
  }, [onOpenChange, reset])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true)
      } else {
        onOpenChange(false)
        setTimeout(reset, 150)
      }
    },
    [onOpenChange, reset],
  )

  const handleProviderSelect = useCallback(
    async (provider: ProviderDTO) => {
      setSelectedProvider(provider)
      setError(undefined)

      // ByteRover + already current → done
      if (provider.id === 'byterover' && provider.isCurrent) {
        onProviderActivated?.()
        resetAndClose()
        return
      }

      // Already connected → show actions
      if (provider.isConnected) {
        setStep('provider_actions')
        return
      }

    // ByteRover + not connected → connect + activate directly
    if (provider.id === 'byterover') {
      setStep('connecting')
      try {
        await connectMutation.mutateAsync({ providerId: provider.id })
        await setActiveMutation.mutateAsync({ providerId: provider.id })
        toast.success(`Connected to ${provider.name}`)
        onProviderActivated?.()
        resetAndClose()
      } catch (error_) {
        toast.error(formatError(error_, 'Connection failed'))
        setStep('select')
      }

        return
      }

      // OpenAI Compatible → base_url step
      if (provider.id === 'openai-compatible') {
        setStep('base_url')
        return
      }

      // Supports OAuth → let user choose between OAuth and API key
      if (provider.supportsOAuth) {
        setStep('auth_method')
        return
      }

      // Requires API key → api_key step
      if (provider.requiresApiKey) {
        setStep('api_key')
        return
      }

    // No key needed → connect directly → model select
    setStep('connecting')
    try {
      await connectMutation.mutateAsync({ providerId: provider.id })
      setIsNewConnection(true)
      setStep('model_select')
    } catch (error_) {
      toast.error(formatError(error_, 'Connection failed'))
      setStep('select')
    }
  }, [connectMutation, onProviderActivated, resetAndClose, setActiveMutation])

  const handleOAuth = useCallback(async (provider: ProviderDTO) => {
    setStep('connecting')
    try {
      const result = await startOAuthMutation.mutateAsync({providerId: provider.id})
      if (!result.success) {
        toast.error(result.error ?? 'Failed to start OAuth')
        setStep('select')
        return
      }

        if (result.authUrl) {
          window.open(result.authUrl, '_blank')
        }

      const callbackResult = await awaitOAuthMutation.mutateAsync({ providerId: provider.id })
      if (callbackResult.success) {
        setIsNewConnection(true)
        setStep('model_select')
      } else {
        toast.error(callbackResult.error ?? 'OAuth failed')
        setStep('select')
      }
    } catch (error_) {
      toast.error(formatError(error_, 'OAuth failed'))
      setStep('select')
    }
  }, [awaitOAuthMutation, startOAuthMutation])

  const handleAction = useCallback(
    async (actionId: ProviderActionId) => {
      if (!selectedProvider) return

    switch (actionId) {
      case 'activate': {
        setStep('connecting')
        try {
          await setActiveMutation.mutateAsync({ providerId: selectedProvider.id })
          toast.success(`Activated ${selectedProvider.name}`)
          onProviderActivated?.()
          resetAndClose()
        } catch (error_) {
          setError(formatError(error_, 'Failed'))
          setStep('provider_actions')
        }

          break
        }

        case 'change_model': {
          setStep('model_select')
          break
        }

      case 'disconnect': {
        setStep('connecting')
        try {
          await disconnectMutation.mutateAsync({ providerId: selectedProvider.id })
          toast.success(`Disconnected ${selectedProvider.name}`)
          setStep('select')
          setSelectedProvider(undefined)
          setError(undefined)
        } catch (error_) {
          setError(formatError(error_, 'Failed'))
          setStep('provider_actions')
        }

          break
        }

        case 'reconfigure': {
          setStep('base_url')
          break
        }

        case 'reconnect_oauth': {
          await handleOAuth(selectedProvider)
          break
        }

        case 'replace': {
          setStep('api_key')
          break
        }
      }
    },
    [disconnectMutation, handleOAuth, onProviderActivated, resetAndClose, selectedProvider, setActiveMutation],
  )

  const handleBaseUrlSubmit = useCallback((url: string) => {
    setBaseUrl(url)
    setStep('api_key')
  }, [])

  const handleApiKeySubmit = useCallback(
    async (apiKey: string) => {
      if (!selectedProvider) return

    // Validate first (skip for openai-compatible)
    if (selectedProvider.id !== 'openai-compatible' && apiKey) {
      try {
        const result = await validateMutation.mutateAsync({ apiKey, providerId: selectedProvider.id })
        if (!result.isValid) {
          setError(result.error ?? 'Invalid API key')
          return
        }
      } catch (error_) {
        setError(formatError(error_, 'Validation failed'))
        return
      }
    }

    setStep('connecting')
    try {
      await connectMutation.mutateAsync({
        apiKey: apiKey || undefined,
        baseUrl: baseUrl ?? undefined,
        providerId: selectedProvider.id,
      })
      setIsNewConnection(true)
      setStep('model_select')
    } catch (error_) {
      setError(formatError(error_, 'Connection failed'))
      setStep('api_key')
    }
  }, [baseUrl, connectMutation, selectedProvider, validateMutation])

  const handleModelSelect = useCallback(
    async (model: ModelDTO) => {
      if (!selectedProvider) return

      try {
        await setActiveModelMutation.mutateAsync({
          contextLength: model.contextLength,
          modelId: model.id,
          providerId: selectedProvider.id,
        })

      if (isNewConnection) {
        toast.success(`Connected to ${selectedProvider.name}`)
        onProviderActivated?.()
        resetAndClose()
      } else {
        toast.success(`Model set to ${model.name}`)
        setStep('provider_actions')
      }
    } catch (error_) {
      toast.error(formatError(error_, 'Failed to set model'))
    }
  }, [isNewConnection, onProviderActivated, resetAndClose, selectedProvider, setActiveModelMutation])

  const handleApiKeyBack = useCallback(() => {
    setError(undefined)
    if (selectedProvider?.id === 'openai-compatible') {
      setStep('base_url')
    } else if (selectedProvider?.supportsOAuth) {
      setStep('auth_method')
    } else {
      setStep('select')
    }
  }, [selectedProvider])

  const renderStep = () => {
    switch (step) {
      case 'api_key': {
        return selectedProvider ? (
          <ApiKeyStep
            error={error}
            isOptional={selectedProvider.id === 'openai-compatible'}
            isValidating={validateMutation.isPending}
            onBack={handleApiKeyBack}
            onSubmit={(key) => handleApiKeySubmit(key)}
            provider={selectedProvider}
          />
        ) : null
      }

      case 'auth_method': {
        return selectedProvider ? (
          <AuthMethodStep
            onBack={() => {
              setStep('select')
              setSelectedProvider(undefined)
              setError(undefined)
            }}
            onSelect={(method) => {
              if (method === 'oauth') {
                handleOAuth(selectedProvider)
              } else {
                setStep('api_key')
              }
            }}
            provider={selectedProvider}
          />
        ) : null
      }

      case 'base_url': {
        return selectedProvider ? (
          <BaseUrlStep
            error={error}
            onBack={() => {
              setStep('select')
              setError(undefined)
            }}
            onSubmit={handleBaseUrlSubmit}
            provider={selectedProvider}
          />
        ) : null
      }

      case 'connecting': {
        return (
          <div className="flex flex-col items-center gap-3 py-12">
            <LoaderCircle className="text-primary size-6 animate-spin" />
            <p className="text-muted-foreground text-sm">Connecting to {selectedProvider?.name}...</p>
          </div>
        )
      }

      case 'model_select': {
        return selectedProvider ? (
          <ModelSelectStep
            onBack={() => {
              if (isNewConnection) {
                setStep('select')
              } else {
                setStep('provider_actions')
              }
            }}
            onSelect={handleModelSelect}
            providerId={selectedProvider.id}
          />
        ) : null
      }

      case 'provider_actions': {
        return selectedProvider ? (
          <ProviderActionStep
            error={error}
            onAction={handleAction}
            onBack={() => {
              setStep('select')
              setSelectedProvider(undefined)
              setError(undefined)
            }}
            provider={selectedProvider}
          />
        ) : null
      }

      case 'select': {
        return <ProviderSelectStep onSelect={(p) => handleProviderSelect(p)} providers={providers} />
      }

      default: {
        return null
      }
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="flex h-150 flex-col sm:max-w-lg"
        showCloseButton={step === 'select' || step === 'model_select' || step === 'connecting'}
      >
        {tourStepLabel && <TourStepBadge label={tourStepLabel} />}
        {renderStep()}
      </DialogContent>
    </Dialog>
  )
}
