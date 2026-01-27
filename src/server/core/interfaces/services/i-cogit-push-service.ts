import type {CogitPushContext} from '../../domain/entities/cogit-push-context.js'
import type {CogitPushResponse} from '../../domain/entities/cogit-push-response.js'

/**
 * Parameters for pushing context files to CoGit.
 */
export type PushParams = {
  accessToken: string
  branch: string
  contexts: CogitPushContext[]
  sessionKey: string
  spaceId: string
  teamId: string
}

/**
 * Interface for pushing context files to the CoGit service.
 * Handles the push operation to store context files in the CoGit repository.
 */
export interface ICogitPushService {
  /**
   * Pushes context files to the CoGit repository.
   * Implements a two-request SHA flow to handle concurrent updates.
   * @param params Push parameters including auth, branch, and context files
   * @returns CogitPushResponse containing commit SHA and status
   * @throws Error if push fails
   */
  push: (params: PushParams) => Promise<CogitPushResponse>
}
