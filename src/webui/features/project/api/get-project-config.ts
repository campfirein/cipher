import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {type BrvConfigDTO} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

// Daemon's existing endpoint used by agent child processes on startup
// (src/server/infra/daemon/brv-server.ts:474). Re-used so the webui can read
// team/space linkage per-project without adding a new transport event.
const GET_PROJECT_CONFIG_EVENT = 'state:getProjectConfig'

interface GetProjectConfigRequest {
  projectPath: string
}

/**
 * Mirrors the daemon's wire shape (see brv-server.ts:487-491). Top-level
 * `spaceId` / `teamId` are the agent-process contract — the webui only reads
 * `brvConfig.teamName` / `brvConfig.spaceName`, but we keep the duplicates so
 * this type stays a faithful response decoder.
 */
interface GetProjectConfigResponse {
  brvConfig?: BrvConfigDTO
  spaceId: string
  storagePath: string
  teamId: string
}

export const getProjectConfig = (projectPath: string): Promise<GetProjectConfigResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<GetProjectConfigResponse, GetProjectConfigRequest>(GET_PROJECT_CONFIG_EVENT, {projectPath})
}

export const getProjectConfigQueryOptions = (projectPath: string) =>
  queryOptions({
    enabled: projectPath.length > 0,
    queryFn: () => getProjectConfig(projectPath),
    queryKey: ['project-config', projectPath],
  })

type UseGetProjectConfigOptions = {
  projectPath: string
  queryConfig?: QueryConfig<typeof getProjectConfigQueryOptions>
}

export const useGetProjectConfig = ({projectPath, queryConfig}: UseGetProjectConfigOptions) =>
  useQuery({...queryConfig, ...getProjectConfigQueryOptions(projectPath)})
