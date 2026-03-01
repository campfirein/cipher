/**
 * ModelSelectStep Component
 *
 * Model selection step used within the provider flow.
 * Fetches models for a given provider and renders ModelDialog for selection.
 */

import {useQueryClient} from '@tanstack/react-query'
import {Box, Text, useInput} from 'ink'
import React, {useCallback, useMemo, useState} from 'react'

import {useTheme} from '../../../hooks/index.js'
import {formatTransportError} from '../../../utils/index.js'
import {getModelsQueryOptions, useGetModels} from '../../model/api/get-models.js'
import {useSetActiveModel} from '../../model/api/set-active-model.js'
import {ModelDialog, type ModelItem} from '../../model/components/model-dialog.js'
import {getActiveProviderConfigQueryOptions} from '../api/get-active-provider-config.js'

export interface ModelSelectStepProps {
  /** Whether the step is active for keyboard input */
  isActive?: boolean
  /** Called when model selection is cancelled (skip) */
  onCancel: () => void
  /** Called when a model is selected and set */
  onComplete: (modelName: string) => void
  /** The provider ID to fetch models for */
  providerId: string
  /** The provider display name */
  providerName: string
}

export const ModelSelectStep: React.FC<ModelSelectStepProps> = ({
  isActive = true,
  onCancel,
  onComplete,
  providerId,
  providerName,
}) => {
  const {theme: {colors}} = useTheme()
  const [error, setError] = useState<null | string>(null)
  const queryClient = useQueryClient()

  const {data: modelData, isError: isModelsError, isLoading} = useGetModels({
    providerId,
    queryConfig: {enabled: Boolean(providerId)},
  })

  const setActiveModelMutation = useSetActiveModel()

  const modelItems: ModelItem[] = useMemo(() => {
    if (!modelData) return []
    const favSet = new Set(modelData.favorites)
    const recentSet = new Set(modelData.recent)

    return modelData.models.map((model) => ({
      contextLength: model.contextLength,
      id: model.id,
      isCurrent: model.id === modelData.activeModel,
      isFavorite: favSet.has(model.id),
      isFree: model.isFree,
      isRecent: recentSet.has(model.id),
      name: model.name,
      pricing: model.pricing,
      provider: model.provider,
    }))
  }, [modelData])

  const handleSelect = useCallback(async (model: ModelItem) => {
    setError(null)
    try {
      await setActiveModelMutation.mutateAsync({
        contextLength: model.contextLength,
        modelId: model.id,
        providerId,
      })
      queryClient.invalidateQueries({queryKey: getModelsQueryOptions(providerId).queryKey})
      queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
      onComplete(model.name)
    } catch (error_) {
      setError(formatTransportError(error_))
    }
  }, [onComplete, providerId, queryClient, setActiveModelMutation])

  // Allow Esc to go back when no models available
  useInput((_input, key) => {
    if (key.escape && modelItems.length === 0) {
      onCancel()
    }
  }, {isActive: isActive && modelItems.length === 0})

  if (isLoading) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading models...</Text>
      </Box>
    )
  }

  if (modelItems.length === 0) {
    const emptyMessage = isModelsError ? 'Failed to load models.' : 'No models available.'
    return (
      <Box gap={2}>
        <Text color={colors.dimText}>{emptyMessage}</Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Esc</Text> Back
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
      <ModelDialog
        activeModelId={modelData?.activeModel}
        isActive={isActive}
        models={modelItems}
        onCancel={onCancel}
        onSelect={handleSelect}
        providerName={providerName}
      />
    </Box>
  )
}
