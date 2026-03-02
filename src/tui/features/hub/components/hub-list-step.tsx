import {Box, Text} from 'ink'
import React from 'react'

import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTerminalBreakpoint, useTheme} from '../../../hooks/index.js'

const SKILL_COLOR = '#10b96e'
const BUNDLE_COLOR = '#636bff'

interface HubListStepProps {
  entries: HubEntryDTO[]
  isActive: boolean
  onCancel: () => void
  onSelect: (entry: HubEntryDTO) => void
}

export function HubListStep({entries, isActive, onCancel, onSelect}: HubListStepProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()
  const {rows} = useTerminalBreakpoint()

  // SelectableList uses (availableHeight - 4) as the visible item count.
  // Each hub item renders 3 lines (id line + description + marginBottom blank).
  //
  // Chrome lines outside SelectableList (external):
  //   header (2) + footer (1) + command input bar (3) = 6
  // Chrome lines inside SelectableList (internal):
  //   border top/bottom (2) + title+margin (2) + search+margin (2)
  //   + keybind hints+margin (2) + scroll indicators (2 worst case) = 10
  // Total chrome = 16, so lines available for items = rows - 16
  // Visible items = floor((rows - 16) / 3), then add back the 4 that
  // SelectableList subtracts internally. Min 7 ensures at least 3 items.
  const availableHeight = Math.max(7, Math.floor((rows - 16) / 3) + 4)

  return (
    <SelectableList<HubEntryDTO>
      availableHeight={availableHeight}
      filterKeys={(entry) => [
        entry.id,
        entry.name,
        entry.description,
        ...entry.tags,
        entry.author.name,
        ...(entry.registry ? [entry.registry] : []),
      ]}
      isActive={isActive}
      items={entries}
      keyExtractor={(entry) => `${entry.id}-${entry.registry}`}
      onCancel={onCancel}
      onSelect={onSelect}
      renderItem={(entry) => {
        const typeColor = entry.type === 'agent-skill' ? SKILL_COLOR : BUNDLE_COLOR
        const typeLabel = entry.type === 'agent-skill' ? 'skill' : 'bundle'

        return (
          <Box flexDirection="column" marginBottom={1}>
            {/* Line 1: id - type - version [- registry] */}
            <Box gap={1}>
              <Text bold color={colors.text}>
                {entry.id}
              </Text>
              <Text color={colors.dimText}>-</Text>
              <Text color={typeColor}>{typeLabel}</Text>
              <Text color={colors.dimText}>-</Text>
              <Text color={colors.dimText}>v{entry.version}</Text>
              {entry.registry && (
                <>
                  <Text color={colors.dimText}>-</Text>
                  <Text color={colors.dimText}>({entry.registry})</Text>
                </>
              )}
            </Box>
            {/* Line 2: description */}
            <Text color={colors.dimText}>{entry.description}</Text>
          </Box>
        )
      }}
      searchPlaceholder="Search skills & bundles..."
      title={`BRV Hub  ${entries.length} entries`}
    />
  )
}
