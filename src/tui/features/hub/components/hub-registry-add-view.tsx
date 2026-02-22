import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useState} from 'react'

import type {HubProgressEvent} from '../../../../shared/transport/events/hub-events.js'

import {HubEvents} from '../../../../shared/transport/events/hub-events.js'
import {useTheme} from '../../../hooks/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useAddHubRegistry} from '../api/add-hub-registry.js'

interface HubRegistryAddViewProps {
  authScheme?: string
  headerName?: string
  name: string
  onCancel: () => void
  onComplete: (message: string) => void
  token?: string
  url: string
}

export function HubRegistryAddView({
  authScheme,
  headerName,
  name,
  onComplete,
  token,
  url,
}: HubRegistryAddViewProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const addMutation = useAddHubRegistry()

  React.useEffect(() => {
    const {apiClient} = useTransportStore.getState()
    let unsub: (() => void) | undefined

    if (apiClient) {
      unsub = apiClient.on<HubProgressEvent>(HubEvents.REGISTRY_ADD_PROGRESS, (progressData) => {
        setProgressMessages((prev) => [...prev, progressData.message])
      })
    }

    addMutation
      .mutateAsync({authScheme, headerName, name, token, url})
      .then((result) => {
        unsub?.()
        onComplete(result.message)
      })
      .catch((error: unknown) => {
        unsub?.()
        onComplete(`Failed to add registry: ${error instanceof Error ? error.message : 'Unknown error'}`)
      })

    return () => {
      unsub?.()
    }
  }, [])

  return (
    <Box flexDirection="column">
      {progressMessages.map((msg, i) => (
        <Text color={colors.dimText} key={i}>
          {msg}
        </Text>
      ))}
      <Box gap={1}>
        <Text color={colors.primary}>
          <Spinner type="dots" />
        </Text>
        <Text color={colors.text}>
          Adding registry <Text bold>{name}</Text>...
        </Text>
      </Box>
    </Box>
  )
}
