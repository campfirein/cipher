import {
  type ProviderCancelOAuthRequest,
  type ProviderCancelOAuthResponse,
  ProviderEvents,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type CancelOAuthDTO = {
  providerId: string
}

export const cancelOAuth = ({providerId}: CancelOAuthDTO): Promise<ProviderCancelOAuthResponse | void> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.resolve()

  return apiClient.request<ProviderCancelOAuthResponse, ProviderCancelOAuthRequest>(ProviderEvents.CANCEL_OAUTH, {
    providerId,
  })
}
