/**
 * InitProjectPage
 *
 * Shown when .brv/ doesn't exist at cwd.
 * Confirms with the user, then runs local init + vc init via daemon.
 * On success, invalidates status cache → useAppViewMode transitions forward.
 */

import {useQueryClient} from '@tanstack/react-query'
import {Box, Text, useApp} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useState} from 'react'

import type {InitLocalResponse} from '../../../shared/transport/events/init-events.js'
import type {IVcInitResponse} from '../../../shared/transport/events/vc-events.js'

import {InitEvents} from '../../../shared/transport/events/init-events.js'
import {VcEvents} from '../../../shared/transport/events/vc-events.js'
import {EnterPrompt} from '../../components/enter-prompt.js'
import {getStatusQueryOptions} from '../../features/status/api/get-status.js'
import {useTheme} from '../../hooks/index.js'
import {useTransportStore} from '../../stores/transport-store.js'
import {MainLayout} from '../layouts/main-layout.js'

type InitState = 'confirm' | 'done' | 'error' | 'running'

export function InitProjectPage(): React.ReactNode {
  const queryClient = useQueryClient()
  const {
    theme: {colors},
  } = useTheme()
  const [state, setState] = useState<InitState>('confirm')
  const {exit} = useApp()
  const [error, setError] = useState<string>()

  const runInit = useCallback(async () => {
    setState('running')

    try {
      const {apiClient} = useTransportStore.getState()
      if (!apiClient) throw new Error('Not connected to daemon')

      // Step 1: Local init
      await apiClient.request<InitLocalResponse>(InitEvents.LOCAL, {force: false})

      // Step 2: VC init
      await apiClient.request<IVcInitResponse>(VcEvents.INIT, {})

      setState('done')
      // Invalidate status so useAppViewMode re-evaluates and transitions
      queryClient.invalidateQueries(getStatusQueryOptions())
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Initialization failed')
      setState('error')
    }
  }, [queryClient])

  const handleConfirm = useCallback(
    (confirmed: boolean) => {
      if (confirmed) {
        runInit()
      } else {
        exit()
      }
    },
    [exit, runInit],
  )

  return (
    <MainLayout showInput={false}>
      <Box flexDirection="column" paddingTop={1}>
        {state === 'confirm' && (
          <Box flexDirection="column" gap={1}>
            <Text color={colors.secondary}>Project not initialized in {process.cwd()}</Text>
            <EnterPrompt action="initialize ByteRover here" onEnter={() => handleConfirm(true)} />
          </Box>
        )}

        {state === 'running' && (
          <Text color={colors.text}>
            <Spinner type="dots" /> Initializing project...
          </Text>
        )}

        {state === 'error' && <Text color={colors.errorText}>{error}</Text>}
      </Box>
    </MainLayout>
  )
}
