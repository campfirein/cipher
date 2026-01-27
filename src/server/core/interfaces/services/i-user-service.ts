import type {User} from '../domain/entities/user.js'

/**
 * Interface for user-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface IUserService {
  /**
   * Fetches the current authenticated user's information.
   * @param accessToken The OAuth access token for authentication
   * @param sessionKey The session key for tracking the user session
   * @returns A promise that resolves to the User entity
   */
  getCurrentUser: (accessToken: string, sessionKey: string) => Promise<User>
}
