import {Box, Text} from 'ink'
import React from 'react'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'

interface ListItem {
  id: string
  name: string
}

export interface ConfirmSwitchStepProps {
  agentName: string
  fromType: string
  isActive: boolean
  onConfirm: (confirmed: boolean) => void
  toType: string
}

export const ConfirmSwitchStep: React.FC<ConfirmSwitchStepProps> = ({
  agentName,
  fromType,
  isActive,
  onConfirm,
  toType,
}) => {
  const {theme: {colors}} = useTheme()

  const items: ListItem[] = [
    {id: 'yes', name: 'Yes'},
    {id: 'no', name: 'No'},
  ]

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.text}>
          Switch {agentName} from {fromType} to {toType}?
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
