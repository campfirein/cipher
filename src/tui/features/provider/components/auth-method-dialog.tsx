import {Box, Text} from 'ink'
import React from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

interface AuthMethodItem {
  description: string
  id: 'api-key' | 'oauth'
  name: string
}

export interface AuthMethodDialogProps {
  isActive?: boolean
  onCancel: () => void
  onSelect: (method: 'api-key' | 'oauth') => void
  provider: ProviderDTO
}

export const AuthMethodDialog: React.FC<AuthMethodDialogProps> = ({
  isActive = true,
  onCancel,
  onSelect,
  provider,
}) => {
  const {theme: {colors}} = useTheme()

  const items: AuthMethodItem[] = [
    {
      description: 'Authenticate in your browser',
      id: 'oauth',
      name: provider.oauthLabel ?? 'Sign in with OAuth',
    },
    {
      description: 'Enter your API key manually',
      id: 'api-key',
      name: 'API Key',
    },
  ]

  return (
    <SelectableList<AuthMethodItem>
      filterKeys={(item) => [item.id, item.name]}
      isActive={isActive}
      items={items}
      keyExtractor={(item) => item.id}
      onCancel={onCancel}
      onSelect={(item) => onSelect(item.id)}
      renderItem={(item, isItemActive) => (
        <Box gap={2}>
          <Text
            backgroundColor={isItemActive ? colors.dimText : undefined}
            color={colors.text}
          >
            {item.name.padEnd(25)}
          </Text>
          <Text color={colors.dimText}>{item.description}</Text>
        </Box>
      )}
      title={`${provider.name} — Choose authentication method`}
    />
  )
}
