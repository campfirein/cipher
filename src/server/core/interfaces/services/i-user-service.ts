import type {User} from '../../domain/entities/user.js'

/**
 * Parameters for updating the current user.
 */
export type UpdateCurrentUserParams = {
  hasOnboardedCli?: boolean
}

/**
 * Interface for user-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface IUserService {
  /**
   * Fetches the current authenticated user's information.
   * @param sessionKey The session key for tracking the user session
   * @returns A promise that resolves to the User entity
   */
  getCurrentUser: (sessionKey: string) => Promise<User>

  /**
   * Updates the current authenticated user's information.
   * @param sessionKey The session key for tracking the user session
   * @param params The fields to update
   * @returns A promise that resolves to the updated User entity
   */
  updateCurrentUser: (sessionKey: string, params: UpdateCurrentUserParams) => Promise<User>
}
