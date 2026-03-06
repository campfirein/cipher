import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {FooEvents, type FooInitResponse} from '../../../../shared/transport/events/foo-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const executeInit = (): Promise<FooInitResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<FooInitResponse>(FooEvents.INIT, {})
}

type UseExecuteInitOptions = {
  mutationConfig?: MutationConfig<typeof executeInit>
}

export const useExecuteInit = ({mutationConfig}: UseExecuteInitOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeInit,
  })
