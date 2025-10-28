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

  public async getSpaces(
    accessToken: string,
    sessionKey: string,
    option?: {fetchAll?: boolean; limit?: number; offset?: number},
  ): Promise<{spaces: Space[]; total: number}> {
    try {
      const httpClient = new AuthenticatedHttpClient(accessToken, sessionKey)

      // Scenario 1: Fetch all automatically via auto-pagination
      if (option?.fetchAll === true) {
        return await this.fetchAllSpaces(httpClient)
      }

      // Scenario 2 & 3: Single request (with or without pagination params)
      const params = new URLSearchParams()
      if (option?.limit !== undefined) {
        params.append('limit', option.limit.toString())
      }

      if (option?.offset !== undefined) {
        params.append('offset', option.offset.toString())
      }

      const url = `${this.config.apiBaseUrl}/spaces${params.toString() ? `?${params.toString()}` : ''}`
      const response = await httpClient.get<ListSpacesApiResponse>(url, {
        timeout: this.config.timeout,
      })

      return {
        spaces: response.data.spaces.map((spaceData) => this.mapToSpace(spaceData)),
        total: response.data.total,
      }
    } catch (error) {
      throw new Error(`Failed to fetch spaces: ${(error as Error).message}`)
    }
  }

  private async fetchAllSpaces(httpClient: AuthenticatedHttpClient): Promise<{spaces: Space[]; total: number}> {
    const pageSize = 100 // Larger pages for fewer requests
    let offset = 0
    let allSpaces: Space[] = []
    let total = 0
    while (true) {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: offset.toString(),
      })

      // eslint-disable-next-line no-await-in-loop
      const response = await httpClient.get<ListSpacesApiResponse>(
        `${this.config.apiBaseUrl}/spaces?${params.toString()}`,
        {timeout: this.config.timeout},
      )
      const pageSpaces = response.data.spaces.map((spaceData) => this.mapToSpace(spaceData))
      allSpaces = [...allSpaces, ...pageSpaces]
      total = response.data.total
      // Stop if we've fetched everything or got empty page
      if (allSpaces.length >= total || pageSpaces.length === 0) {
        break
      }

      offset += pageSize
    }

    return {spaces: allSpaces, total}
  }

  private mapToSpace(spaceData: SpaceApiResponse): Space {
    return new Space(spaceData.id, spaceData.name, spaceData.team_id, spaceData.team.name)
  }
}
