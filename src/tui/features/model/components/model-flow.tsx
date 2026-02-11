/**
 * ModelFlow Component
 *
 * Multi-step React flow for the /model command.
 * State machine: loading → select → setting → done
 *
 * 1. Checks for active provider (if none or ByteRover, shows message)
 * 2. Fetches models for the active provider
 * 3. Renders ModelDialog for selection
 * 4. Sets the selected model as active
 */

import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import {useTheme} from '../../../hooks/index.js'
import {useGetProviders} from '../../provider/api/get-providers.js'
import {useGetModels} from '../api/get-models.js'
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

  // Fetch providers to find the active one
  const {data: providerData, isLoading: isLoadingProviders} = useGetProviders()
  const activeProvider = providerData?.providers.find((p) => p.isCurrent)

  // Fetch models for the active provider (only when we have one that's not ByteRover)
  const shouldFetchModels = Boolean(activeProvider && activeProvider.id !== 'byterover')
  const {data: modelData, isLoading: isLoadingModels} = useGetModels({
    providerId: activeProvider?.id ?? '',
    queryConfig: {enabled: shouldFetchModels},
  })

  const setActiveModelMutation = useSetActiveModel({
    providerId: activeProvider?.id ?? '',
  })

  // Transform ModelDTO + metadata into ModelItem for the dialog
  const modelItems: ModelItem[] = useMemo(() => {
    if (!modelData) return []
    const favSet = new Set(modelData.favorites)
    const recentSet = new Set(modelData.recent)

    return modelData.models.map((m) => ({
      contextLength: m.contextLength,
      id: m.id,
      isCurrent: m.id === modelData.activeModel,
      isFavorite: favSet.has(m.id),
      isFree: m.isFree,
      isRecent: recentSet.has(m.id),
      name: m.name,
      pricing: m.pricing,
      provider: m.provider,
    }))
  }, [modelData])

  const handleSelect = useCallback(
    async (model: ModelItem) => {
      if (!activeProvider) return

      setError(null)
      try {
        await setActiveModelMutation.mutateAsync({
          modelId: model.id,
          providerId: activeProvider.id,
        })
        onComplete(`Model set to: ${model.name}`)
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_))
      }
    },
    [activeProvider, onComplete, setActiveModelMutation],
  )

  // Auto-complete for cases that don't need UI interaction
  const earlyExitMessage = useMemo(() => {
    if (isLoadingProviders || isLoadingModels) return null
    if (!activeProvider) return 'No active provider. Run /provider to select one.'
    if (activeProvider.id === 'byterover')
      return 'ByteRover uses an internal model. Run /provider to switch to an external provider for model selection.'
    if (!isLoadingModels && modelItems.length === 0 && modelData) return 'No models available from this provider.'
    return null
  }, [activeProvider, isLoadingModels, isLoadingProviders, modelData, modelItems.length])

  useEffect(() => {
    if (earlyExitMessage) {
      onComplete(earlyExitMessage)
    }
  }, [earlyExitMessage, onComplete])

  // Loading states
  if (isLoadingProviders) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading...</Text>
      </Box>
    )
  }

  if (isLoadingModels || !activeProvider || activeProvider.id === 'byterover' || modelItems.length === 0) {
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
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
      <ModelDialog
        activeModelId={modelData?.activeModel}
        isActive={isActive}
        models={modelItems}
        onCancel={onCancel}
        onSelect={handleSelect}
        providerName={activeProvider.name}
      />
    </Box>
  )
}
