import type {ICogitPullService, PullParams} from '../../core/interfaces/services/i-cogit-pull-service.js'

import {CogitSnapshot} from '../../core/domain/entities/cogit-snapshot.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type HttpCogitPullServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

/**
 * HTTP implementation of ICogitPullService for ByteRover CoGit service.
 * Fetches context tree snapshots from a CoGit repository.
 */
export class HttpCogitPullService implements ICogitPullService {
  private readonly config: HttpCogitPullServiceConfig

  public constructor(config: HttpCogitPullServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000,
    }
  }

  public async pull(params: PullParams): Promise<CogitSnapshot> {
    const baseUrl = `${this.config.apiBaseUrl}/organizations/${params.teamId}/projects/${params.spaceId}/git/snapshot`
    const url = `${baseUrl}?branch=${encodeURIComponent(params.branch)}`

    const httpClient = new AuthenticatedHttpClient(params.accessToken, params.sessionKey)

    try {
      const response = await httpClient.get<unknown>(url, {
        timeout: this.config.timeout,
      })

      return CogitSnapshot.fromJson(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to pull from CoGit: ${message}`)
    }
  }
}
