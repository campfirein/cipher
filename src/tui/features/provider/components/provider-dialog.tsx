/**
 * ProviderDialog Component
 *
 * Interactive dialog for selecting and connecting to LLM providers.
 * Shows available providers grouped by category with connection status.
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

/**
 * Props for ProviderDialog.
 */
export interface ProviderDialogProps {
  /** Hide the Cancel keybind hint and disable Esc to cancel */
  hideCancelButton?: boolean
  /** Whether the dialog is active for keyboard input */
  isActive?: boolean
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Callback when a provider is selected */
  onSelect: (provider: ProviderDTO) => void
  /** All available providers (already includes isConnected/isCurrent) */
  providers: ProviderDTO[]
  /** Custom title for the dialog */
  title?: string
}

/**
 * ProviderDialog displays a list of available providers for selection.
 */
export const ProviderDialog: React.FC<ProviderDialogProps> = ({
  hideCancelButton = false,
  isActive = true,
  onCancel,
  onSelect,
  providers,
  title = 'Connect a Provider',
}) => {
  const {theme: {colors}} = useTheme()

  // Find current provider for the list
  const currentProvider = useMemo(
    () => providers.find((p) => p.isCurrent),
    [providers],
  )

  return (
    <SelectableList<ProviderDTO>
      currentItem={currentProvider}
      filterKeys={(item) => [item.id, item.name, item.description]}
      getCurrentKey={(item) => item.id}
      hideCancelButton={hideCancelButton}
      isActive={isActive}
      items={providers}
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
          {item.isConnected && item.authMethod && (
            <Text color={colors.primary}>
              {item.authMethod === 'oauth' ? '[OAuth]' : '[API Key]'}
            </Text>
          )}
        </Box>
      )}
      searchPlaceholder="Search providers..."
      title={title}
    />
  )
}
