/**
 * AuthInitializer Component
 *
 * Initializes auth state from transport and subscribes to auth state changes.
 * Must be rendered within TransportProvider.
 */

import React, {useEffect} from 'react'

import {AuthEvents, type AuthStateChangedEvent} from '../../../../shared/transport/events/index.js'
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
    })

    return unsubscribe
  }, [apiClient, setState])

  // Don't render children until transport is connected
  if (!apiClient) {
    return null
  }

  return <>{children}</>
}
