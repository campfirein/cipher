import type {Space} from '../domain/entities/space.js'

/**
 * Interface for space-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface ISpaceService {
  /**
   * Fetches all spaces accessible to the authenticated user.
   * @param accessToken The OAuth access token for authentication
   * @returns A promise that resolves to an array of Space entities
   */
  getSpaces: (accessToken: string) => Promise<Space[]>
}
