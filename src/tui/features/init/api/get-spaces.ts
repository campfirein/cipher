import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {InitEvents, type InitGetSpacesRequest, type InitGetSpacesResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type GetInitSpacesDTO = {
  teamId: string
}

export const getInitSpaces = ({teamId}: GetInitSpacesDTO): Promise<InitGetSpacesResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<InitGetSpacesResponse, InitGetSpacesRequest>(InitEvents.GET_SPACES, {teamId})
}

export const getInitSpacesQueryOptions = (teamId: string) =>
  queryOptions({
    enabled: Boolean(teamId),
    queryFn: () => getInitSpaces({teamId}),
    queryKey: ['init', 'spaces', teamId],
  })

type UseGetInitSpacesOptions = {
  queryConfig?: QueryConfig<typeof getInitSpacesQueryOptions>
  teamId: string
}

export const useGetInitSpaces = ({queryConfig, teamId}: UseGetInitSpacesOptions) =>
  useQuery({
    ...getInitSpacesQueryOptions(teamId),
    ...queryConfig,
  })
