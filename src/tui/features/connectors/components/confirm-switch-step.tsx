import {Box, Text} from 'ink'
import React from 'react'

import type {ConnectorType} from '../../../../shared/types/connector-type.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {getConnectorName} from '../utils/get-connector-name.js'

interface ListItem {
  id: string
  name: string
}

export interface ConfirmSwitchStepProps {
  agentName: string
  fromType: ConnectorType
  isActive: boolean
  onConfirm: (confirmed: boolean) => void
  toType: ConnectorType
}

export const ConfirmSwitchStep: React.FC<ConfirmSwitchStepProps> = ({
  agentName,
  fromType,
  isActive,
  onConfirm,
  toType,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const items: ListItem[] = [
    {id: 'yes', name: 'Yes'},
    {id: 'no', name: 'No'},
  ]

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.text}>
          Switch {agentName} from {getConnectorName(fromType)} to {getConnectorName(toType)}?
        </Text>
      </Box>
      <SelectableList<ListItem>
        filterKeys={(item) => [item.name]}
        getCurrentKey={(item) => item.id}
        isActive={isActive}
        items={items}
        keyExtractor={(item) => item.id}
        onCancel={() => onConfirm(false)}
        onSelect={(item) => onConfirm(item.id === 'yes')}
        renderItem={(item, isHighlighted) => (
          <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
            {item.name}
          </Text>
        )}
        title="Confirm"
      />
    </Box>
  )
}
