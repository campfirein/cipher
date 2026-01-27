import type {IUserService} from '../../core/interfaces/services/i-user-service.js'

import {User} from '../../core/domain/entities/user.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type UserServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type UserMeApiResponse = {
  code: number
  data: {
    email: string
    id: string
    name: string
  }
  message: string
}

export class HttpUserService implements IUserService {
  private readonly config: UserServiceConfig

  public constructor(config: UserServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 10_000, // Default 10 seconds timeout
    }
  }

  public async getCurrentUser(accessToken: string, sessionKey: string): Promise<User> {
    // IMPORTANT: Do not try-catch here - let callers handle errors (e.g., distinguish 401 from network errors)
    const httpClient = new AuthenticatedHttpClient(accessToken, sessionKey)
    const response = await httpClient.get<UserMeApiResponse>(`${this.config.apiBaseUrl}/user/me`, {
      timeout: this.config.timeout,
    })

    return this.mapToUser(response.data)
  }

  private mapToUser(userData: UserMeApiResponse['data']): User {
    return new User(userData.email, userData.id, userData.name)
  }
}
