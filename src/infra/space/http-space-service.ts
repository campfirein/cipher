import axios, {isAxiosError} from 'axios'

import type {ISpaceService} from '../../core/interfaces/i-space-service.js'

import {Space} from '../../core/domain/entities/space.js'

export type SpaceServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type SpaceApiResponse = {
  created_at: string
  description?: string
  full_name?: string
  id: string
  name: string
  status: string
  storage_path?: string
  team: {
    avatar_url?: string
    created_at: string
    description?: string
    display_name: string
    id: string
    is_active: boolean
    name: string
    updated_at: string
  }
  team_id: string
  updated_at: string
  visibility: string
}

type ListSpacesApiResponse = {
  data: SpaceApiResponse[]
  limit: number
  offset: number
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

  public async getSpaces(accessToken: string): Promise<Space[]> {
    try {
      const response = await axios.get<ListSpacesApiResponse>(`${this.config.apiBaseUrl}/spaces`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: this.config.timeout,
      })

      return response.data.data.map((spaceData) => this.mapToSpace(spaceData))
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response) {
          throw new Error(
            `Failed to fetch spaces: ${error.response.status} ${error.response.statusText}`,
          )
        } else if (error.request) {
          throw new Error('Failed to fetch spaces: Network error')
        }
      }

      throw new Error(`Failed to fetch spaces: ${(error as Error).message}`)
    }
  }

  private mapToSpace(spaceData: SpaceApiResponse): Space {
    return new Space(
      spaceData.id,
      spaceData.name,
      spaceData.team_id,
      spaceData.team.name,
    )
  }
}
