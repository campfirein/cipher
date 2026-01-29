import type {Space} from '../../domain/entities/space.js'

/**
 * Interface for space-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface ISpaceService {
  /**
   * Fetches spaces accessible to the authenticated user within a specific team.
   * @param accessToken The OAuth access token for authentication
   * @param sessionKey The session key for tracking the user session
   * @param teamId The team ID to filter spaces by
   * @param option Optional pagination options
   * @param option.limit Maximum number of spaces to fetch in a single request
   * @param option.offset Number of spaces to skip (for pagination)
   * @param option.fetchAll If true, automatically paginate to fetch all spaces
   * @returns A promise that resolves to an object containing:
   *  - spaces: Array of Space entities
   *  - total: Total number of spaces available (across all pages)
   */
  getSpaces: (
    accessToken: string,
    sessionKey: string,
    teamId: string,
    option?: {
      fetchAll?: boolean
      limit?: number
      offset?: number
    },
  ) => Promise<{
    spaces: Space[]
    total: number
  }>
}
