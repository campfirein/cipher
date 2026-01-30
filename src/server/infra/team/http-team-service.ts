import type {ITeamService} from '../../core/interfaces/services/i-team-service.js'

import {Team} from '../../core/domain/entities/team.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type TeamServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type TeamApiResponse = {
  avatar_url: string
  created_at: string
  description: string
  display_name: string
  id: string
  is_active: boolean
  is_default: boolean
  name: string
  updated_at: string
}

type ListTeamsApiResponse = {
  code: number
  data: ListTeamsApiData
  message: string
}

type ListTeamsApiData = {
  limit: number
  offset: number
  teams: TeamApiResponse[]
  total: number
}

export class HttpTeamService implements ITeamService {
  private readonly config: TeamServiceConfig

  public constructor(config: TeamServiceConfig) {
    this.config = {
      ...config,
      timeout: 10_000, // Default 10 seconds timeout
    }
  }

  public async getTeams(
    sessionKey: string,
    option?: {fetchAll?: boolean; isActive?: boolean; limit?: number; offset?: number},
  ): Promise<{teams: Team[]; total: number}> {
    try {
      const httpClient = new AuthenticatedHttpClient(sessionKey)

      // Scenario 1: Fetch all automatically via auto-pagination
      if (option?.fetchAll === true) {
        return await this.fetchAllTeams(httpClient, option?.isActive)
      }

      // Scenario 2 & 3: Single request (with or without pagination params)
      const params = new URLSearchParams()
      if (option?.limit !== undefined) {
        params.append('limit', option.limit.toString())
      }

      if (option?.offset !== undefined) {
        params.append('offset', option.offset.toString())
      }

      if (option?.isActive !== undefined) {
        params.append('is_active', option.isActive.toString())
      }

      const url = `${this.config.apiBaseUrl}/teams${params.toString() ? `?${params.toString()}` : ''}`
      const response = await httpClient.get<ListTeamsApiResponse>(url, {
        timeout: this.config.timeout,
      })

      return {
        teams: response.data.teams.map((teamData) => this.mapToTeam(teamData)),
        total: response.data.total,
      }
    } catch (error) {
      throw new Error(`Failed to fetch teams: ${getErrorMessage(error)}`)
    }
  }

  private async fetchAllTeams(
    httpClient: AuthenticatedHttpClient,
    isActive?: boolean,
  ): Promise<{teams: Team[]; total: number}> {
    const pageSize = 100 // Larger pages for fewer requests
    let offset = 0
    let allTeams: Team[] = []
    let total = 0
    while (true) {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: offset.toString(),
      })

      if (isActive !== undefined) {
        params.append('is_active', isActive.toString())
      }

      // eslint-disable-next-line no-await-in-loop
      const response = await httpClient.get<ListTeamsApiResponse>(
        `${this.config.apiBaseUrl}/teams?${params.toString()}`,
        {timeout: this.config.timeout},
      )
      const pageTeams = response.data.teams.map((teamData) => this.mapToTeam(teamData))
      allTeams = [...allTeams, ...pageTeams]
      total = response.data.total
      // Stop if we've fetched everything or got empty page
      if (allTeams.length >= total || pageTeams.length === 0) {
        break
      }

      offset += pageSize
    }

    return {teams: allTeams, total}
  }

  private mapToTeam(teamData: TeamApiResponse): Team {
    return Team.fromJson(teamData)
  }
}
