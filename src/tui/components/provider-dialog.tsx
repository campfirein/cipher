/**
 * ProviderDialog Component
 *
 * Interactive dialog for selecting and connecting to LLM providers.
 * Shows available providers grouped by category with connection status.
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import {
  getProvidersGroupedByCategory,
  type ProviderDefinition,
} from '../../core/domain/entities/provider-registry.js'
import {useTheme} from '../contexts/theme-context.js'
import {SelectableList} from './selectable-list.js'

/**
 * Provider item with connection status.
 */
interface ProviderItem extends ProviderDefinition {
  isConnected: boolean
  isCurrent: boolean
}

/**
 * Props for ProviderDialog.
 */
export interface ProviderDialogProps {
  /** Currently active provider ID */
  activeProviderId: string
  /** Set of connected provider IDs */
  connectedProviders: Set<string>
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when a provider is selected */
  onSelect: (provider: ProviderDefinition) => void
}

/**
 * ProviderDialog displays a list of available providers for selection.
 */
export const ProviderDialog: React.FC<ProviderDialogProps> = ({
  activeProviderId,
  connectedProviders,
  isActive = true,
  onCancel,
  onSelect,
}) => {
  const {theme: {colors}} = useTheme()

  // Get providers with connection status
  const providerItems: ProviderItem[] = useMemo(() => {
    const {other, popular} = getProvidersGroupedByCategory()
    const allProviders = [...popular, ...other]

    return allProviders.map((provider) => ({
      ...provider,
      isConnected: connectedProviders.has(provider.id),
      isCurrent: provider.id === activeProviderId,
    }))
  }, [activeProviderId, connectedProviders])

  // Find current provider for the list
  const currentProvider = providerItems.find((p) => p.isCurrent)

  return (
    <SelectableList<ProviderItem>
      currentItem={currentProvider}
      filterKeys={(item) => [item.id, item.name, item.description]}
      getCurrentKey={(item) => item.id}
      groupBy={(item) => (item.category === 'popular' ? 'Popular' : 'Other')}
      isActive={isActive}
      items={providerItems}
      keyExtractor={(item) => item.id}
      onCancel={onCancel}
      onSelect={(item) => onSelect(item)}
      renderItem={(item, isActive, isCurrent) => (
        <Box gap={2}>
          <Text
            backgroundColor={isActive ? colors.dimText : undefined}
            color={isActive ? colors.text : colors.text}
          >
            {item.name.padEnd(15)}
          </Text>
          <Text color={colors.dimText}>{item.description}</Text>
          {item.isConnected && !isCurrent && (
            <Text color={colors.primary}>[Connected]</Text>
          )}
          {isCurrent && (
            <Text color={colors.primary}>(Current)</Text>
          )}
        </Box>
      )}
      searchPlaceholder="Search providers..."
      title="Connect a Provider"
    />
  )
}
