import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'

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
  name: string
  spaceId: string
  spaceName: string
  teamId: string
  teamName: string
}

type CloneStep = 'cloning' | 'selecting'

interface VcCloneFlowProps extends CustomDialogCallbacks {
  url?: string
}

export function VcCloneFlow({onCancel, onComplete, url}: VcCloneFlowProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  const [step, setStep] = useState<CloneStep>(url ? 'cloning' : 'selecting')
  const [error, setError] = useState<null | string>(null)
  const [selected, setSelected] = useState<null | SpaceItem>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const mutatedRef = useRef(false)

  // Only fetch spaces when no URL is provided (space picker mode)
  const {data, error: fetchError, isLoading} = useGetSpaces({queryConfig: {enabled: !url}})
  const cloneMutation = useExecuteVcClone()

  const allSpaces = useMemo(
    () => (data?.teams ?? []).flatMap((t) => t.spaces),
    [data],
  )

  useEffect(() => {
    if (fetchError && !url) {
      onComplete(formatTransportError(fetchError))
    }
  }, [fetchError, onComplete, url])

  useEffect(() => {
    if (!url && !isLoading && allSpaces.length === 0 && data) {
      onComplete('No spaces found. Please create a space in the ByteRover dashboard first.')
    }
  }, [allSpaces.length, data, isLoading, onComplete, url])

  const spaceItems: SpaceItem[] = useMemo(
    () =>
      allSpaces.map((s) => ({
        name: `${s.teamName}/${s.name}`,
        spaceId: s.id,
        spaceName: s.name,
        teamId: s.teamId,
        teamName: s.teamName,
      })),
    [allSpaces],
  )

  useEffect(() => {
    if (step !== 'cloning' || mutatedRef.current) return
    mutatedRef.current = true

    const {apiClient} = useTransportStore.getState()
    const unsub = apiClient?.on<IVcCloneProgressEvent>(VcEvents.CLONE_PROGRESS, (evt) => {
      setProgressMessages((prev) => [...prev, evt.message])
    })

    // Build the clone request based on URL or space selection
    const request = url
      ? {url}
      : selected
        ? {spaceId: selected.spaceId, spaceName: selected.spaceName, teamId: selected.teamId, teamName: selected.teamName}
        : null

    if (!request) {
      mutatedRef.current = false
      unsub?.()
      return
    }

    cloneMutation.mutate(request, {
      onError(err) {
        unsub?.()
        mutatedRef.current = false
        if (url) {
          onComplete(formatTransportError(err))
        } else {
          setStep('selecting')
          setError(formatTransportError(err))
        }
      },
      onSuccess(result) {
        unsub?.()
        const label = result.teamName && result.spaceName
          ? `${result.teamName}/${result.spaceName}`
          : 'repository'
        onComplete(`Cloned ${label} successfully.`)
      },
    })

    return () => {
      unsub?.()
    }
  }, [onComplete, step, selected, url])

  const handleSelect = useCallback((item: SpaceItem) => {
    setError(null)
    setSelected(item)
    setStep('cloning')
  }, [])

  if (step === 'cloning') {
    return (
      <>
        {progressMessages.map((msg, idx) => (
          <Text key={idx}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Cloning...
        </Text>
      </>
    )
  }

  if (isLoading) {
    return (
      <Box>
        <Text color={colors.dimText}>Fetching spaces...</Text>
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
      <SelectableList<SpaceItem>
        filterKeys={(item) => [item.spaceId, item.name]}
        getCurrentKey={(item) => item.spaceId}
        isActive
        items={spaceItems}
        keyExtractor={(item) => item.spaceId}
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
