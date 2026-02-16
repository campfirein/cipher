/**
 * SpaceSwitchFlow Component
 *
 * React flow for the /space switch command.
 * Fetches spaces → renders selection → switches.
 */

import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {useGetSpaces} from '../api/get-spaces.js'
import {useSwitchSpace} from '../api/switch-space.js'

interface ListItem {
  description: string
  id: string
  name: string
}

export interface SpaceSwitchFlowProps {
  isActive?: boolean
  onCancel: () => void
  onComplete: (message: string) => void
}

export const SpaceSwitchFlow: React.FC<SpaceSwitchFlowProps> = ({isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [error, setError] = useState<null | string>(null)

  const {data, isLoading} = useGetSpaces()
  const switchMutation = useSwitchSpace()

  const allSpaces = useMemo(() => (data?.teams ?? []).flatMap((t) => t.spaces), [data])

  // Auto-complete if no spaces
  useEffect(() => {
    if (!isLoading && allSpaces.length === 0 && data) {
      onComplete('No spaces found. Please create a space in the ByteRover dashboard first.')
    }
  }, [allSpaces.length, data, isLoading, onComplete])

  const spaceItems: ListItem[] = useMemo(
    () =>
      allSpaces.map((s) => ({description: s.isDefault ? '(default)' : '', id: s.id, name: `${s.teamName}/${s.name}`})),
    [allSpaces],
  )

  const handleSelect = useCallback(
    async (item: ListItem) => {
      setError(null)
      try {
        const result = await switchMutation.mutateAsync({spaceId: item.id})
        if (result.success && result.config) {
          onComplete(
            `Successfully switched to space: ${result.config.spaceName}\nConfiguration updated in: .brv/config.json`,
          )
        }
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_))
      }
    },
    [onComplete, switchMutation],
  )

  if (isLoading) {
    return (
      <Box>
        <Text color={colors.dimText}>Fetching spaces...</Text>
      </Box>
    )
  }

  if (allSpaces.length === 0) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={colors.errorText}>{error}</Text>
        </Box>
      )}
      <SelectableList<ListItem>
        filterKeys={(item) => [item.id, item.name]}
        getCurrentKey={(item) => item.id}
        isActive={isActive}
        items={spaceItems}
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
        title="Select a space"
      />
    </Box>
  )
}
