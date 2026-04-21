import {useQueryClient} from '@tanstack/react-query'
import {useEffect} from 'react'

import {ProviderEvents} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getActiveProviderConfigQueryOptions} from '../api/get-active-provider-config'
import {getProvidersQueryOptions} from '../api/get-providers'

export function useProviderSubscriptions() {
  const apiClient = useTransportStore((state) => state.apiClient)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!apiClient) return

    const unsubscribe = apiClient.on(ProviderEvents.UPDATED, () => {
      queryClient.invalidateQueries({queryKey: getProvidersQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
    })

    return unsubscribe
  }, [apiClient, queryClient])
}
