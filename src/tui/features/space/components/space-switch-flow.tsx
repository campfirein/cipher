/**
 * SpaceSwitchFlow Component
 *
 * React flow for the /space switch command.
 * Fetches spaces → renders selection → switches config → pulls context from new space.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {PullProgressEvent} from '../../../../shared/transport/events/index.js'

import {PullEvents} from '../../../../shared/transport/events/index.js'
import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {formatTransportError} from '../../../utils/error-messages.js'
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

type SwitchStep = 'executing' | 'selecting'

export const SpaceSwitchFlow: React.FC<SpaceSwitchFlowProps> = ({isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [error, setError] = useState<null | string>(null)
  const [step, setStep] = useState<SwitchStep>('selecting')
  const [selectedSpaceId, setSelectedSpaceId] = useState<null | string>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])

  const {data, error: fetchError, isLoading} = useGetSpaces()
  const switchMutation = useSwitchSpace()

  const allSpaces = useMemo(() => (data?.teams ?? []).flatMap((t) => t.spaces), [data])

  // Handle fetch error (e.g., not authenticated, not initialized)
  useEffect(() => {
    if (fetchError) {
      onComplete(formatTransportError(fetchError))
    }
  }, [fetchError, onComplete])

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

  // Subscribe to pull progress and execute switch
  useEffect(() => {
    if (step !== 'executing' || !selectedSpaceId) return

    const {apiClient} = useTransportStore.getState()
    let unsubProgress: (() => void) | undefined

    if (apiClient) {
      unsubProgress = apiClient.on<PullProgressEvent>(PullEvents.PROGRESS, (progressData) => {
        setProgressMessages((prev) => [...prev, progressData.message])
      })
    }

    switchMutation.mutate(
      {spaceId: selectedSpaceId},
      {
        onError(error_) {
          unsubProgress?.()
          setStep('selecting')
          setError(formatTransportError(error_))
        },
        onSuccess(result) {
          unsubProgress?.()
          if (!result.success) {
            onComplete(`Failed to switch space: ${result.pullError ?? 'Unknown error'}`)
            return
          }

          const spaceLine = `Successfully switched to space: ${result.config.spaceName}`
          let pullLine: string
          if (result.pullResult) {
            pullLine = `Pulled: +${result.pullResult.added} ~${result.pullResult.edited} -${result.pullResult.deleted}`
            if (result.pullResult.conflicted) {
              pullLine += `\n  ${result.pullResult.conflicted} conflict(s) auto-merged — review .brv/context-tree-conflict/ for original files`
            }
          } else if (result.pullError) {
            pullLine = `Pull skipped: ${result.pullError}`
          } else {
            pullLine = 'No remote context found.'
          }

          onComplete(`${spaceLine}\n${pullLine}\nConfiguration updated in: .brv/config.json`)
        },
      },
    )

    return () => {
      unsubProgress?.()
    }
  }, [step, selectedSpaceId])

  const handleSelect = useCallback((item: ListItem) => {
    setError(null)
    setSelectedSpaceId(item.id)
    setStep('executing')
  }, [])

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

  if (step === 'executing') {
    return (
      <>
        {progressMessages.map((msg, i) => (
          <Text key={i}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Switching space...
        </Text>
      </>
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
