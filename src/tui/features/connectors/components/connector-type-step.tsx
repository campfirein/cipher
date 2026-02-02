import {Box, Text} from 'ink'
import React from 'react'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

interface ListItem {
  description: string
  id: string
  name: string
}

export interface ConnectorTypeStepProps {
  agentName: string
  currentType?: string
  defaultType: string
  isActive: boolean
  onCancel: () => void
  onSelect: (connectorType: string) => void
  supportedTypes: string[]
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
  const {theme: {colors}} = useTheme()

  const items: ListItem[] = supportedTypes.map((t) => ({
    description: t === currentType ? '(current)' : t === defaultType ? '(default)' : '',
    id: t,
    name: t,
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
