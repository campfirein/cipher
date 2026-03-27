import type {ReactNode} from 'react'

import {Badge} from '@campfirein/byterover-packages/components/badge'
import {CardDescription, CardTitle} from '@campfirein/byterover-packages/components/card'
import {useQueryClient} from '@tanstack/react-query'
import {useEffect} from 'react'

import {AuthEvents, type AuthStateChangedEvent} from '../../../../shared/transport/events'
import {useModelStore} from '../../../features/model/stores/model-store'
import {useProviderStore} from '../../../features/provider/stores/provider-store'
import {useTransportStore} from '../../../stores/transport-store'
import {getAuthStateQueryOptions, useGetAuthState} from '../api/get-auth-state'
import {useAuthStore} from '../stores/auth-store'

export function AuthInitializer({children}: {children: ReactNode}) {
  const apiClient = useTransportStore((state) => state.apiClient)
  const connectionState = useTransportStore((state) => state.connectionState)
  const reconnectCount = useTransportStore((state) => state.reconnectCount)
  const isLoadingInitial = useAuthStore((state) => state.isLoadingInitial)
  const queryClient = useQueryClient()
  const setState = useAuthStore((state) => state.setState)

  const {
    data: authState,
    isFetched,
    isLoading,
  } = useGetAuthState({
    queryConfig: {
      enabled: apiClient !== null,
      retry: 5,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
      staleTime: 2 * 60 * 1000,
    },
  })

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
  }, [authState, isFetched, isLoading, setState])

  useEffect(() => {
    if (!apiClient) return

    const unsubscribe = apiClient.on<AuthStateChangedEvent>(AuthEvents.STATE_CHANGED, (data) => {
      setState({
        brvConfig: data.brvConfig,
        isAuthorized: data.isAuthorized,
        user: data.user,
      })

      if (!data.isAuthorized) {
        useProviderStore.getState().reset()
        useModelStore.getState().reset()
      }

      if (data.isAuthorized) {
        queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey}).catch(() => {})
      }
    })

    return unsubscribe
  }, [apiClient, queryClient, setState])

  useEffect(() => {
    if (!apiClient) return
    if (connectionState !== 'connected') return
    if (reconnectCount === 0) return

    queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey}).catch(() => {})
  }, [apiClient, connectionState, queryClient, reconnectCount])

  if (!apiClient) {
    return null
  }

  if (isLoadingInitial) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">Authorizing</Badge>
          <CardTitle>Checking your session</CardTitle>
          <CardDescription>Waiting for the daemon to confirm whether this browser is already signed in.</CardDescription>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
