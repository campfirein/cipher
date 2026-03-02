/**
 * ModelDialog Component
 *
 * Interactive dialog for selecting LLM models.
 * Features:
 * - Grouped display: Favorites, Recent, All models
 * - Tags: [Current], [Free], pricing info
 * - Fuzzy search filtering
 * - Favorite toggle with 'f' key
 * - Keyboard navigation
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

/**
 * Model information for display in the dialog.
 */
export interface ModelItem {
  /** Context window size */
  contextLength?: number
  /** Optional description */
  description?: string
  /** Model ID (e.g., 'anthropic/claude-3.5-sonnet') */
  id: string
  /** Whether this is the current active model */
  isCurrent: boolean
  /** If true, this item represents a provider load failure and is not selectable */
  isError?: boolean
  /** Whether this model is a favorite */
  isFavorite: boolean
  /** Whether this model is free */
  isFree?: boolean
  /** Whether this model was recently used */
  isRecent: boolean
  /** Display name */
  name: string
  /** Pricing per million tokens */
  pricing?: {
    inputPerM: number
    outputPerM: number
  }
  /** Provider name (e.g., 'Anthropic', 'OpenAI') */
  provider?: string
  /** Provider ID (e.g., 'anthropic', 'openai') */
  providerId?: string
}

/**
 * Props for ModelDialog.
 */
export interface ModelDialogProps {
  /** Currently active model ID */
  activeModelId?: string
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Array of models to display */
  models: ModelItem[]
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when a model is selected */
  onSelect: (model: ModelItem) => void
  /** Callback when favorite is toggled */
  onToggleFavorite?: (model: ModelItem) => void
  /** Provider name for title */
  providerName?: string
}

/**
 * Format pricing for display.
 */
function formatPricing(pricing?: {inputPerM: number; outputPerM: number}): string {
  if (!pricing) return ''
  const avgPrice = (pricing.inputPerM + pricing.outputPerM) / 2
  if (avgPrice === 0) return '' // No pricing data available
  if (avgPrice < 0.01) return '$<0.01/M'
  return `$${avgPrice.toFixed(2)}/M`
}

/**
 * Format context length for display.
 */
function formatContextLength(contextLength?: number): string {
  if (!contextLength) return ''

  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(1)}M ctx`
  }

  if (contextLength >= 1000) {
    return `${Math.round(contextLength / 1000)}K ctx`
  }

  return `${contextLength} ctx`
}

/**
 * Get group name for a model item.
 */
function getModelGroup(model: ModelItem): string {
  if (model.isFavorite) return 'Favorites'
  if (model.isRecent) return 'Recent'
  return model.provider ?? 'Models'
}

/**
 * ModelDialog displays a list of models for selection.
 */
export const ModelDialog: React.FC<ModelDialogProps> = ({
  activeModelId,
  isActive = true,
  models,
  onCancel,
  onSelect,
  onToggleFavorite,
  providerName = 'Provider',
}) => {
  const {theme: {colors}} = useTheme()

  // Sort models: favorites first, then recent, then by provider
  const sortedModels = useMemo(() => [...models].sort((a, b) => {
      // Favorites first
      if (a.isFavorite && !b.isFavorite) return -1
      if (!a.isFavorite && b.isFavorite) return 1
      // Then recent
      if (a.isRecent && !b.isRecent) return -1
      if (!a.isRecent && b.isRecent) return 1
      // Then by provider
      const providerCompare = (a.provider ?? '').localeCompare(b.provider ?? '')
      if (providerCompare !== 0) return providerCompare
      // Then by name
      return a.name.localeCompare(b.name)
    }), [models])

  // Find current model for the list
  const currentModel = sortedModels.find((m) => m.id === activeModelId)

  // Custom keybinds for favorite toggle
  const keybinds = onToggleFavorite
    ? [
        {
          action: (item: ModelItem) => onToggleFavorite(item),
          key: 'f',
          label: 'Favorite',
        },
      ]
    : []

  return (
    <SelectableList<ModelItem>
      currentItem={currentModel}
      filterKeys={(item) => [item.id, item.name, item.description ?? '', item.provider ?? '']}
      getCurrentKey={(item) => item.id}
      groupBy={getModelGroup}
      isActive={isActive}
      items={sortedModels}
      keybinds={keybinds}
      keyExtractor={(item) => item.id}
      onCancel={onCancel}
      onSelect={(item) => onSelect(item)}
      renderItem={(item, isActive, isCurrent) => {
        if (item.isError) {
          return (
            <Box>
              <Text color={colors.warning}>{item.name}</Text>
            </Box>
          )
        }

        return (
          <Box gap={2}>
            {/* Model name */}
            <Text
              backgroundColor={isActive ? colors.dimText : undefined}
              color={isActive ? colors.text : colors.text}
            >
              {item.name.padEnd(30)}
            </Text>

            {/* Tags */}
            <Box gap={1}>
              {isCurrent && (
                <Text color={colors.primary}>(Current)</Text>
              )}
              {item.isFree && !isCurrent && (
                <Text color={colors.primary}>[Free]</Text>
              )}
              {item.isFavorite && !isCurrent && (
                <Text color={colors.warning}>★</Text>
              )}
            </Box>

            {/* Pricing and context */}
            <Box gap={1}>
              {item.pricing && !item.isFree && (
                <Text color={colors.dimText}>{formatPricing(item.pricing)}</Text>
              )}
              {item.contextLength && (
                <Text color={colors.dimText}>{formatContextLength(item.contextLength)}</Text>
              )}
            </Box>
          </Box>
        )
      }}
      searchPlaceholder="Search models..."
      title={`Select Model - ${providerName}`}
    />
  )
}
