import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {ModelEvents, type ModelSetActiveRequest, type ModelSetActiveResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getModelsQueryOptions} from './get-models.js'

export type SetActiveModelDTO = {
  modelId: string
  providerId: string
}

export const setActiveModel = ({modelId, providerId}: SetActiveModelDTO): Promise<ModelSetActiveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ModelSetActiveResponse, ModelSetActiveRequest>(ModelEvents.SET_ACTIVE, {modelId, providerId})
}

type UseSetActiveModelOptions = {
  mutationConfig?: MutationConfig<typeof setActiveModel>
  providerId: string
}

export const useSetActiveModel = ({mutationConfig, providerId}: UseSetActiveModelOptions) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getModelsQueryOptions(providerId).queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: setActiveModel,
  })
}
