/**
 * Hook that subscribes to provider update broadcasts and invalidates React Query caches.
 * Call this once from a top-level component to keep provider data fresh
 * when changes happen via oclif commands or other clients.
 */

import {useQueryClient} from '@tanstack/react-query'
import {useEffect} from 'react'

import {ProviderEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getActiveProviderConfigQueryOptions} from '../api/get-active-provider-config.js'
import {getProvidersQueryOptions} from '../api/get-providers.js'

export function useProviderSubscriptions(): void {
  const client = useTransportStore((s) => s.client)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!client) return

    const unsub = client.on(ProviderEvents.UPDATED, () => {
      queryClient.invalidateQueries({queryKey: getProvidersQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
    })

    return unsub
  }, [client, queryClient])
}
