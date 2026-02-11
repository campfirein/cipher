import {Box, Text} from 'ink'
import React from 'react'

import type {ConnectorType} from '../../../../shared/types/connector-type.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {getConnectorName} from '../utils/get-connector-name.js'

interface ListItem {
  description: string
  id: ConnectorType
  name: string
}

export interface ConnectorTypeStepProps {
  agentName: string
  currentType?: ConnectorType
  defaultType: ConnectorType
  isActive: boolean
  onCancel: () => void
  onSelect: (connectorType: ConnectorType) => void
  supportedTypes: ConnectorType[]
}

export const ConnectorTypeStep: React.FC<ConnectorTypeStepProps> = ({
  agentName,
  currentType,
  defaultType,
  isActive,
  onCancel,
  onSelect,
  supportedTypes,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const items: ListItem[] = supportedTypes.map((t) => ({
    description: t === currentType ? '(current)' : t === defaultType ? '(default)' : '',
    id: t,
    name: getConnectorName(t),
  }))

  const handleSelect = (item: ListItem) => {
    onSelect(item.id)
  }

  return (
    <SelectableList<ListItem>
      filterKeys={(item) => [item.name]}
      getCurrentKey={(item) => item.id}
      isActive={isActive}
      items={items}
      keyExtractor={(item) => item.id}
      onCancel={onCancel}
      onSelect={handleSelect}
      renderItem={(item, isHighlighted) => (
        <Box gap={2}>
          <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
            {item.name}
          </Text>
          {item.description && <Text color={colors.dimText}>{item.description}</Text>}
        </Box>
      )}
      title={`Select connector type for ${agentName}`}
    />
  )
}
