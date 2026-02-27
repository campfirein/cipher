import {Box, Text} from 'ink'
import React from 'react'

import type {ConnectorType} from '../../../../shared/types/connector-type.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {getConnectorDescription, getConnectorName} from '../utils/get-connector-name.js'

interface ListItem {
  description: string
  id: ConnectorType
  name: string
  status: string
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
    description: getConnectorDescription(t),
    id: t,
    name: getConnectorName(t),
    status: t === currentType ? '(current)' : t === defaultType ? '(default)' : '',
  }))

  const maxLabelLength = Math.max(
    ...items.map((item) => item.name.length + (item.status ? 1 + item.status.length : 0)),
  )

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
      renderItem={(item, isHighlighted) => {
        const labelLength = item.name.length + (item.status ? 1 + item.status.length : 0)
        const padding = ' '.repeat(maxLabelLength - labelLength)
        return (
          <Box gap={2}>
            <Text>
              <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
                {item.name}
              </Text>
              {item.status && <Text color={colors.primary}>{` ${item.status}`}</Text>}
              {padding}
            </Text>
            <Text color={colors.dimText}>{item.description}</Text>
          </Box>
        )
      }}
      title={`Select connector type for ${agentName}`}
    />
  )
}
