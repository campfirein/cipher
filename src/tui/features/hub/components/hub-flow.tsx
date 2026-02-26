import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useEffect, useState} from 'react'

import type {HubProgressEvent} from '../../../../shared/transport/events/hub-events.js'
import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

import {HubEvents} from '../../../../shared/transport/events/hub-events.js'
import {useTheme} from '../../../hooks/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useGetHubEntries} from '../api/get-hub-entries.js'
import {useInstallHubEntry} from '../api/install-hub-entry.js'
import {HubAgentStep} from './hub-agent-step.js'
import {HubDetailStep} from './hub-detail-step.js'
import {HubListStep} from './hub-list-step.js'

type FlowStep = 'detail' | 'installing' | 'list' | 'select-agent'

export interface HubFlowProps {
  isActive?: boolean
  onCancel: () => void
  onComplete: (message: string) => void
}

export const HubFlow: React.FC<HubFlowProps> = ({isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [step, setStep] = useState<FlowStep>('list')
  const [selectedEntry, setSelectedEntry] = useState<HubEntryDTO | null>(null)

  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const {data, error, isLoading} = useGetHubEntries()
  const installMutation = useInstallHubEntry()

  const entries = data?.entries ?? []

  useEffect(() => {
    const {apiClient} = useTransportStore.getState()
    if (!apiClient || !isLoading) return

    const unsub = apiClient.on<HubProgressEvent>(HubEvents.LIST_PROGRESS, (progressData) => {
      setProgressMessages((prev) => [...prev, progressData.message])
    })

    return () => {
      unsub()
    }
  }, [isLoading])

  const handleSelectEntry = useCallback((entry: HubEntryDTO) => {
    setSelectedEntry(entry)
    setStep('detail')
  }, [])

  const handleBack = useCallback(() => {
    setSelectedEntry(null)
    setStep('list')
  }, [])

  const handleInstall = useCallback(
    (entry: HubEntryDTO) => {
      if (entry.type === 'agent-skill') {
        setStep('select-agent')
      } else {
        setStep('installing')
        installMutation
          .mutateAsync({entryId: entry.id, registry: entry.registry})
          .then((result) => onComplete(result.message))
          .catch((error_: unknown) =>
            onComplete(`Install failed: ${error_ instanceof Error ? error_.message : 'Unknown error'}`),
          )
      }
    },
    [installMutation, onComplete],
  )

  const handleAgentSelect = useCallback(
    (agentDisplayName: string) => {
      if (!selectedEntry) return
      setStep('installing')
      installMutation
        .mutateAsync({agent: agentDisplayName, entryId: selectedEntry.id, registry: selectedEntry.registry})
        .then((result) => onComplete(result.message))
        .catch((error_: unknown) =>
          onComplete(`Install failed: ${error_ instanceof Error ? error_.message : 'Unknown error'}`),
        )
    },
    [installMutation, onComplete, selectedEntry],
  )

  const handleAgentBack = useCallback(() => {
    setStep('detail')
  }, [])

  if (isLoading) {
    return (
      <Box flexDirection="column">
        {progressMessages.map((msg, i) => (
          <Text color={colors.dimText} key={i}>
            {msg}
          </Text>
        ))}
        <Text>
          <Spinner type="dots" />
        </Text>
      </Box>
    )
  }

  if (error) {
    onComplete(`Failed to load hub: ${error.message}`)
    return null
  }

  switch (step) {
    case 'detail': {
      if (!selectedEntry) return null

      return <HubDetailStep entry={selectedEntry} isActive={isActive} onBack={handleBack} onInstall={handleInstall} />
    }

    case 'installing': {
      return (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text color={colors.primary}>
              <Spinner type="dots" />
            </Text>
            <Text color={colors.text}>
              Installing <Text bold>{selectedEntry?.name}</Text>...
            </Text>
          </Box>
          <Text color={colors.dimText}>Downloading files from hub registry</Text>
        </Box>
      )
    }

    case 'list': {
      return <HubListStep entries={entries} isActive={isActive} onCancel={onCancel} onSelect={handleSelectEntry} />
    }

    case 'select-agent': {
      return <HubAgentStep isActive={isActive} onBack={handleAgentBack} onSelect={handleAgentSelect} />
    }

    default: {
      return null
    }
  }
}
