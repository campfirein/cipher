import {Text} from 'ink'
import React from 'react'

import type {AgentDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

interface ListItem {
  id: string
  name: string
}

export interface AgentSearchStepProps {
  agents: AgentDTO[]
  isActive: boolean
  onCancel: () => void
  onSelect: (agent: AgentDTO) => void
}

export const AgentSearchStep: React.FC<AgentSearchStepProps> = ({
  agents,
  isActive,
  onCancel,
  onSelect,
}) => {
  const {theme: {colors}} = useTheme()

  const items: ListItem[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
  }))

  const handleSelect = (item: ListItem) => {
    const agent = agents.find((a) => a.id === item.id)
    if (agent) {
      onSelect(agent)
    }
  }

  return (
    <SelectableList<ListItem>
      filterKeys={(item) => [item.id, item.name]}
      getCurrentKey={(item) => item.id}
      isActive={isActive}
      items={items}
      keyExtractor={(item) => item.id}
      onCancel={onCancel}
      onSelect={handleSelect}
      renderItem={(item, isHighlighted) => (
        <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
          {item.name}
        </Text>
      )}
      searchPlaceholder="Search agents..."
      title="Which agent are you using?"
    />
  )
}
