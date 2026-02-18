import {Text} from 'ink'
import React, {useMemo} from 'react'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {useGetAgents} from '../../connectors/api/get-agents.js'

interface AgentItem {
  id: string
  name: string
}

interface HubAgentStepProps {
  isActive: boolean
  onBack: () => void
  onSelect: (agentDisplayName: string) => void
}

export function HubAgentStep({isActive, onBack, onSelect}: HubAgentStepProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()
  const {data} = useGetAgents()

  const items: AgentItem[] = useMemo(
    () =>
      (data?.agents ?? [])
        .filter((agent) => agent.supportedConnectorTypes.includes('skill'))
        .map((agent) => ({id: agent.id, name: agent.name})),
    [data],
  )

  return (
    <SelectableList<AgentItem>
      filterKeys={(item) => [item.name]}
      isActive={isActive}
      items={items}
      keyExtractor={(item) => item.id}
      onCancel={onBack}
      onSelect={(item) => onSelect(item.name)}
      renderItem={(item, isHighlighted) => (
        <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
          {item.name}
        </Text>
      )}
      searchPlaceholder="Search agents..."
      title="Select target agent"
    />
  )
}
