import {
  type SourceAddRequest,
  type SourceAddResponse,
  SourceEvents,
  type SourceListResponse,
  type SourceRemoveRequest,
  type SourceRemoveResponse,
} from '../../../../shared/transport/events/source-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const addSourceViaTransport = (targetPath: string, alias?: string): Promise<SourceAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  const request: SourceAddRequest = {alias, targetPath}
  return apiClient.request<SourceAddResponse>(SourceEvents.ADD, request)
}

export const removeSourceViaTransport = (aliasOrPath: string): Promise<SourceRemoveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  const request: SourceRemoveRequest = {aliasOrPath}
  return apiClient.request<SourceRemoveResponse>(SourceEvents.REMOVE, request)
}

export const listSourcesViaTransport = (): Promise<SourceListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<SourceListResponse>(SourceEvents.LIST)
}
