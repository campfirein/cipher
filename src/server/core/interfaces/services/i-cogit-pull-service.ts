import type {CogitSnapshot} from '../../domain/entities/cogit-snapshot.js'

/**
 * Parameters for pulling a snapshot from CoGit.
 */
export type PullParams = {
  accessToken: string
  branch: string
  sessionKey: string
  spaceId: string
  teamId: string
}

/**
 * Interface for pulling context tree snapshots from the CoGit service.
 * Retrieves the complete state of context files from a CoGit repository.
 */
export interface ICogitPullService {
  /**
   * Pulls the latest snapshot from the CoGit repository.
   * @param params Pull parameters including auth and branch
   * @returns CogitSnapshot containing files and metadata
   * @throws Error if pull fails
   */
  pull: (params: PullParams) => Promise<CogitSnapshot>
}
