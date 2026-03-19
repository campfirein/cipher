import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {
  ModelEvents,
  type ModelSetActiveRequest,
  type ModelSetActiveResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type SetActiveModelDTO = {
  contextLength?: number
  modelId: string
  providerId: string
}

export const setActiveModel = async ({
  contextLength,
  modelId,
  providerId,
}: SetActiveModelDTO): Promise<ModelSetActiveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  const response = await apiClient.request<ModelSetActiveResponse, ModelSetActiveRequest>(ModelEvents.SET_ACTIVE, {
    contextLength,
    modelId,
    providerId,
  })
  if (!response.success && response.error) {
    throw new Error(response.error)
  }

  return response
}

type UseSetActiveModelOptions = {
  mutationConfig?: MutationConfig<typeof setActiveModel>
}

export const useSetActiveModel = ({mutationConfig}: UseSetActiveModelOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: setActiveModel,
  })
