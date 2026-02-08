/**
 * AuthInitializer Component
 *
 * Initializes auth state from transport and subscribes to auth state changes.
 * Must be rendered within TransportProvider.
 */

import React, {useEffect} from 'react'

import {AuthEvents, type AuthStateChangedEvent} from '../../../../shared/transport/events/index.js'
import {useCommandsStore} from '../../../features/commands/stores/commands-store.js'
import {useModelStore} from '../../../features/model/stores/model-store.js'
import {useOnboardingStore} from '../../../features/onboarding/stores/onboarding-store.js'
import {useProviderStore} from '../../../features/provider/stores/provider-store.js'
import {useTasksStore} from '../../../features/tasks/stores/tasks-store.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useGetAuthState} from '../api/get-auth-state.js'
import {useAuthStore} from '../stores/auth-store.js'

export function AuthInitializer({children}: {children: React.ReactNode}): React.ReactNode {
  const {apiClient} = useTransportStore()
  const setState = useAuthStore((s) => s.setState)

  // Fetch initial auth state (only when transport is connected)
  const {
    data: authState,
    isFetched,
    isLoading,
  } = useGetAuthState({
    queryConfig: {
      enabled: apiClient !== null,
      retry: 5,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
      staleTime: Number.POSITIVE_INFINITY,
    },
  })

  // Update store when auth state is fetched (including loading state)
  useEffect(() => {
    if (authState) {
      setState({
        brvConfig: authState.brvConfig ?? null,
        isAuthorized: authState.isAuthorized,
        user: authState.user ?? null,
      })
      useAuthStore.setState({isLoadingInitial: false})
    } else if (isFetched && !isLoading) {
      useAuthStore.setState({isLoadingInitial: false})
    }
  }, [authState, isLoading, isFetched, setState])

  // Subscribe to auth state changes
  useEffect(() => {
    if (!apiClient) return

    const unsubscribe = apiClient.on<AuthStateChangedEvent>(AuthEvents.STATE_CHANGED, (data) => {
      setState({
        brvConfig: data.brvConfig ?? null,
        isAuthorized: data.isAuthorized,
        user: data.user ?? null,
      })

      // Clean up user-specific stores when auth is lost
      if (!data.isAuthorized) {
        useCommandsStore.getState().clearMessages()
        useTasksStore.getState().clearTasks()
        useOnboardingStore.getState().reset()
        useProviderStore.getState().reset()
        useModelStore.getState().reset()
      }
    })

    return unsubscribe
  }, [apiClient, setState])

  // Don't render children until transport is connected
  if (!apiClient) {
    return null
  }

  return <>{children}</>
}
