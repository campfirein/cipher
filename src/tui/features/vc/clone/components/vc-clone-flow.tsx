import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {IVcCloneProgressEvent} from '../../../../../shared/transport/events/vc-events.js'
import type {CustomDialogCallbacks} from '../../../../types/commands.js'

import {VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {SelectableList} from '../../../../components/selectable-list.js'
import {useTheme} from '../../../../hooks/index.js'
import {useTransportStore} from '../../../../stores/transport-store.js'
import {formatTransportError} from '../../../../utils/error-messages.js'
import {useGetSpaces} from '../../../space/api/get-spaces.js'
import {useExecuteVcClone} from '../api/execute-vc-clone.js'

interface SpaceItem {
  id: string
  name: string
  spaceId: string
  spaceName: string
  teamId: string
  teamName: string
}

type CloneStep = 'cloning' | 'selecting'

export function VcCloneFlow({onCancel, onComplete}: CustomDialogCallbacks): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  const [step, setStep] = useState<CloneStep>('selecting')
  const [error, setError] = useState<null | string>(null)
  const [selected, setSelected] = useState<null | SpaceItem>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])

  const {data, error: fetchError, isLoading} = useGetSpaces()
  const cloneMutation = useExecuteVcClone()

  const allSpaces = useMemo(
    () => (data?.teams ?? []).flatMap((t) => t.spaces),
    [data],
  )

  useEffect(() => {
    if (fetchError) {
      onComplete(formatTransportError(fetchError))
    }
  }, [fetchError, onComplete])

  useEffect(() => {
    if (!isLoading && allSpaces.length === 0 && data) {
      onComplete('No spaces found. Please create a space in the ByteRover dashboard first.')
    }
  }, [allSpaces.length, data, isLoading, onComplete])

  const spaceItems: SpaceItem[] = useMemo(
    () =>
      allSpaces.map((s) => ({
        id: s.id,
        name: `${s.teamName}/${s.name}`,
        spaceId: s.id,
        spaceName: s.name,
        teamId: s.teamId,
        teamName: s.teamName,
      })),
    [allSpaces],
  )

  useEffect(() => {
    if (step !== 'cloning' || !selected) return

    const {apiClient} = useTransportStore.getState()
    const unsub = apiClient?.on<IVcCloneProgressEvent>(VcEvents.CLONE_PROGRESS, (evt) => {
      setProgressMessages((prev) => [...prev, evt.message])
    })

    cloneMutation.mutate(
      {spaceId: selected.spaceId, spaceName: selected.spaceName, teamId: selected.teamId, teamName: selected.teamName},
      {
        onError(err) {
          unsub?.()
          setStep('selecting')
          setError(formatTransportError(err))
        },
        onSuccess(result) {
          unsub?.()
          onComplete(`Cloned ${result.teamName}/${result.spaceName} successfully.`)
        },
      },
    )

    return () => {
      unsub?.()
    }
  }, [step, selected])

  const handleSelect = useCallback((item: SpaceItem) => {
    setError(null)
    setSelected(item)
    setStep('cloning')
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

  if (step === 'cloning') {
    return (
      <>
        {progressMessages.map((msg, i) => (
          <Text key={i}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Cloning...
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
      <SelectableList<SpaceItem>
        filterKeys={(item) => [item.id, item.name]}
        getCurrentKey={(item) => item.id}
        isActive
        items={spaceItems}
        keyExtractor={(item) => item.id}
        onCancel={onCancel}
        onSelect={handleSelect}
        renderItem={(item, isHighlighted) => (
          <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
            {item.name}
          </Text>
        )}
        title="Select a space to clone"
      />
    </Box>
  )
}
