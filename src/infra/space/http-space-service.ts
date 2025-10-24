import type {ISpaceService} from '../../core/interfaces/i-space-service.js'

import {Space} from '../../core/domain/entities/space.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type SpaceServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type Team = {
  name: string
}

type SpaceApiResponse = {
  created_at: string
  default_branch: string
  description: string
  full_name: string
  id: string
  name: string
  size: number
  status: string
  storage_path: string
  team: Team
  team_id: string
  updated_at: string
  visibility: string
}

type ListSpacesApiResponse = {
  code: number
  data: ListSpacesApiData
  message: string
}

type ListSpacesApiData = {
  spaces: SpaceApiResponse[]
  total: number
}

export class HttpSpaceService implements ISpaceService {
  private readonly config: SpaceServiceConfig

  public constructor(config: SpaceServiceConfig) {
    this.config = {
      ...config,
      timeout: 10_000, // Default 10 seconds timeout
    }
  }

  public async getSpaces(accessToken: string, sessionKey: string): Promise<Space[]> {
    try {
      const httpClient = new AuthenticatedHttpClient(accessToken, sessionKey)
      const response = await httpClient.get<ListSpacesApiResponse>(
        `${this.config.apiBaseUrl}/spaces`,
        {timeout: this.config.timeout},
      )

      return response.data.spaces.map((spaceData) => this.mapToSpace(spaceData))
    } catch (error) {
      throw new Error(`Failed to fetch spaces: ${(error as Error).message}`)
    }
  }

  private mapToSpace(spaceData: SpaceApiResponse): Space {
    return new Space(spaceData.id, spaceData.name, spaceData.team_id, spaceData.team.name)
  }
}
