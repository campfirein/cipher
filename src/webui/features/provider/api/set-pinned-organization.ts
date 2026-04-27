import {useMutation, useQueryClient} from '@tanstack/react-query'

import {
  BillingEvents,
  type BillingSetPinnedOrganizationRequest,
  type BillingSetPinnedOrganizationResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {PINNED_ORGANIZATION_QUERY_KEY} from './get-pinned-organization'

export const setPinnedOrganization = (
  organizationId: string | undefined,
): Promise<BillingSetPinnedOrganizationResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<BillingSetPinnedOrganizationResponse, BillingSetPinnedOrganizationRequest>(
    BillingEvents.SET_PINNED_ORGANIZATION,
    {organizationId},
  )
}

export const useSetPinnedOrganization = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (organizationId: string | undefined) => setPinnedOrganization(organizationId),
    async onSuccess() {
      await queryClient.invalidateQueries({queryKey: PINNED_ORGANIZATION_QUERY_KEY})
    },
  })
}
