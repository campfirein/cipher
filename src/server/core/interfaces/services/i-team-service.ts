import type {Team} from '../../domain/entities/team.js'

/**
 * Interface for team-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface ITeamService {
  /**
   * Fetches teams where the authenticated user is a member.
   * @param sessionKey The session key for tracking the user session
   * @param option Optional filtering and pagination options
   * @param option.limit Maximum number of teams to fetch in a single request
   * @param option.offset Number of teams to skip (for pagination)
   * @param option.isActive Filter teams by active status
   * @param option.fetchAll If true, automatically paginate to fetch all teams
   * @returns A promise that resolves to an object containing:
   *  - teams: Array of Team entities
   *  - total: Total number of teams available (across all pages)
   */
  getTeams: (
    sessionKey: string,
    option?: {
      fetchAll?: boolean
      isActive?: boolean
      limit?: number
      offset?: number
    },
  ) => Promise<{
    teams: Team[]
    total: number
  }>
}
