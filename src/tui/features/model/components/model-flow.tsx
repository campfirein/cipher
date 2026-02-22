/**
 * ModelFlow Component
 *
 * Multi-step React flow for the /model command.
 * Fetches models from all connected providers, groups by provider,
 * and allows the user to select a model.
 */

import {useQueryClient} from '@tanstack/react-query'
import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import {useTheme} from '../../../hooks/index.js'
import {getActiveProviderConfigQueryOptions, useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config.js'
import {useGetProviders} from '../../provider/api/get-providers.js'
import {getModelsByProvidersQueryOptions, useGetModelsByProviders} from '../api/get-models-by-providers.js'
import {useSetActiveModel} from '../api/set-active-model.js'
import {ModelDialog, type ModelItem} from './model-dialog.js'

export interface ModelFlowProps {
  /** Whether the flow is active for keyboard input */
  isActive?: boolean
  /** Called when the flow is cancelled */
  onCancel: () => void
  /** Called when the flow completes */
  onComplete: (message: string) => void
}

export const ModelFlow: React.FC<ModelFlowProps> = ({isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [error, setError] = useState<null | string>(null)
  const queryClient = useQueryClient()

  const {data: providerData, isLoading: isLoadingProviders} = useGetProviders()
  const {data: activeData} = useGetActiveProviderConfig()

  const connectedProviders = useMemo(
    () => providerData?.providers.filter((p) => p.isConnected) ?? [],
    [providerData],
  )

  const connectedProviderIds = useMemo(
    () => connectedProviders.map((p) => p.id),
    [connectedProviders],
  )

  const isOnlyByteRover = connectedProviders.length === 1 && connectedProviders[0].id === 'byterover'

  const {data: modelsData, isLoading: isLoadingModels} = useGetModelsByProviders({
    providerIds: connectedProviderIds,
    queryConfig: {enabled: connectedProviderIds.length > 0 && !isOnlyByteRover},
  })

  const setActiveModelMutation = useSetActiveModel()

  const modelItems: ModelItem[] = useMemo(() => {
    if (!modelsData) return []

    return modelsData.models.map((model) => ({
      contextLength: model.contextLength,
      id: model.id,
      isCurrent: model.id === activeData?.activeModel,
      isFavorite: false,
      isFree: model.isFree,
      isRecent: false,
      name: model.name,
      pricing: model.pricing,
      provider: model.provider,
      providerId: model.providerId,
    }))
  }, [activeData?.activeModel, modelsData])

  const handleSelect = useCallback(
    async (model: ModelItem) => {
      if (!model.providerId) return

      setError(null)
      try {
        await setActiveModelMutation.mutateAsync({
          modelId: model.id,
          providerId: model.providerId,
        })
        queryClient.invalidateQueries({queryKey: getModelsByProvidersQueryOptions(connectedProviderIds).queryKey})
        queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
        onComplete(`Model set to: ${model.name}`)
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_))
      }
    },
    [connectedProviderIds, onComplete, queryClient, setActiveModelMutation],
  )

  const earlyExitMessage = useMemo(() => {
    if (isLoadingProviders || isLoadingModels) return null
    if (connectedProviders.length === 0) return 'No connected providers. Run /provider to connect one.'
    if (isOnlyByteRover)
      return 'ByteRover uses an internal model. Run /provider to switch to an external provider for model selection.'
    if (!isLoadingModels && modelItems.length === 0 && modelsData) return 'No models available.'
    return null
  }, [connectedProviders.length, isLoadingModels, isLoadingProviders, isOnlyByteRover, modelItems.length, modelsData])

  useEffect(() => {
    if (earlyExitMessage) {
      onComplete(earlyExitMessage)
    }
  }, [earlyExitMessage, onComplete])

  if (isLoadingProviders) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading...</Text>
      </Box>
    )
  }

  if (isLoadingModels || connectedProviders.length === 0 || isOnlyByteRover || modelItems.length === 0) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading models...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={colors.warning}>{error}</Text>
        </Box>
      )}
      <ModelDialog
        activeModelId={activeData?.activeModel}
        isActive={isActive}
        models={modelItems}
        onCancel={onCancel}
        onSelect={handleSelect}
        providerName="All Providers"
      />
    </Box>
  )
}
