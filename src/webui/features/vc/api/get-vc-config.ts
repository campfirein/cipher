import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  type IVcConfigRequest,
  type IVcConfigResponse,
  type VcConfigKey,
  VcErrorCode,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {hasCode} from '../../../lib/transport-error'
import {useTransportStore} from '../../../stores/transport-store'

export type VcConfigValues = {
  email: string | undefined
  name: string | undefined
}

async function readKey(key: VcConfigKey): Promise<string | undefined> {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')
  try {
    const response = await apiClient.request<IVcConfigResponse, IVcConfigRequest>(VcEvents.CONFIG, {key})
    return response.value
  } catch (error) {
    if (hasCode(error) && error.code === VcErrorCode.CONFIG_KEY_NOT_SET) return undefined
    throw error
  }
}

export const getVcConfig = async (): Promise<VcConfigValues> => {
  const [name, email] = await Promise.all([readKey('user.name'), readKey('user.email')])
  return {email, name}
}

export const getVcConfigQueryOptions = () =>
  queryOptions({
    queryFn: getVcConfig,
    queryKey: ['vc', 'config'],
    staleTime: 5000,
  })

type UseGetVcConfigOptions = {
  queryConfig?: QueryConfig<typeof getVcConfigQueryOptions>
}

export const useGetVcConfig = ({queryConfig}: UseGetVcConfigOptions = {}) =>
  useQuery({
    ...getVcConfigQueryOptions(),
    ...queryConfig,
  })
