import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {HubProgressEvent} from '../../../../shared/transport/events/hub-events.js'

import {HubEvents} from '../../../../shared/transport/events/hub-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useGetHubRegistries} from '../api/list-hub-registries.js'

interface HubRegistryListViewProps {
  onCancel: () => void
  onComplete: (message: string) => void
}

export function HubRegistryListView({onComplete}: HubRegistryListViewProps): React.ReactNode {
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const {data, error, isLoading} = useGetHubRegistries()

  useEffect(() => {
    const {apiClient} = useTransportStore.getState()
    if (!apiClient || !isLoading) return

    const unsub = apiClient.on<HubProgressEvent>(HubEvents.REGISTRY_LIST_PROGRESS, (progressData) => {
      setProgressMessages((prev) => [...prev, progressData.message])
    })

    return () => {
      unsub()
    }
  }, [isLoading])

  if (isLoading) {
    return (
      <Box flexDirection="column">
        {progressMessages.map((msg, i) => (
          <Text key={i}>{msg}</Text>
        ))}
        <Text>
          <Spinner type="dots" /> Loading registries...
        </Text>
      </Box>
    )
  }

  if (error) {
    onComplete(`Failed to load registries: ${error.message}`)
    return null
  }

  const registries = data?.registries ?? []

  const lines = registries.map((r) => {
    const scheme = r.authScheme && r.authScheme !== 'none' && r.authScheme !== 'bearer' ? ` [${r.authScheme}]` : ''
    const tokenLabel = r.hasToken ? ' (authenticated)' : ''
    const statusLabel = r.status === 'ok' ? `${r.entryCount} entries` : `error: ${r.error}`
    return `  ${r.name} - ${r.url}${scheme}${tokenLabel} (${statusLabel})`
  })

  onComplete(`Registries (${registries.length}):\n${lines.join('\n')}`)
  return null
}
