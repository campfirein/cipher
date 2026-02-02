import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import type {ConnectorDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

interface ListItem {
  description: string
  id: string
  name: string
}

const CONNECT_NEW_AGENT_ID = '__new__'

export interface ConnectorListStepProps {
  connectors: ConnectorDTO[]
  error: null | string
  isActive: boolean
  onAddNew: () => void
  onCancel: () => void
  onSelectConnector: (connector: ConnectorDTO) => void
}

export const ConnectorListStep: React.FC<ConnectorListStepProps> = ({
  connectors,
  error,
  isActive,
  onAddNew,
  onCancel,
  onSelectConnector,
}) => {
  const {theme: {colors}} = useTheme()

  const listItems: ListItem[] = useMemo(
    () => [
      ...connectors.map((c) => ({
        description: `Connected via ${c.connectorType}`,
        id: c.agent,
        name: `${c.agent} (${c.connectorType})`,
      })),
      {description: '', id: CONNECT_NEW_AGENT_ID, name: '+ Connect a new agent'},
    ],
    [connectors],
  )

  const handleSelect = (item: ListItem) => {
    if (item.id === CONNECT_NEW_AGENT_ID) {
      onAddNew()
      return
    }

    const connector = connectors.find((c) => c.agent === item.id)
    if (connector) {
      onSelectConnector(connector)
    }
  }

  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
      {connectors.length === 0 && (
        <Box marginBottom={1}>
          <Text color={colors.dimText}>No agents connected yet.</Text>
        </Box>
      )}
      <SelectableList<ListItem>
        filterKeys={(item) => [item.id, item.name]}
        getCurrentKey={(item) => item.id}
        isActive={isActive}
        items={listItems}
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
        title="Manage agent connectors"
      />
    </Box>
  )
}
