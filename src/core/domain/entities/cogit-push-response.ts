/**
 * Parameters for creating a CogitPushResponse instance.
 */
export type CogitPushResponseParams = {
  commitSha: string
  message: string
  success: boolean
}

export class CogitPushResponse {
  // TODO: might not need this
  public readonly commitSha: string
  public readonly message: string
  public readonly success: boolean

  public constructor(params: CogitPushResponseParams) {
    if (params.success && params.commitSha.trim().length === 0) {
      throw new Error('CogitPushResponse commitSha cannot be empty for successful response')
    }

    this.commitSha = params.commitSha
    this.message = params.message
    this.success = params.success
  }

  /**
   * Creates a CogitPushResponse instance from a JSON object.
   * Handles snake_case API response format.
   * @param json JSON object representing the response
   * @returns An instance of CogitPushResponse
   * @throws TypeError if required fields are missing or have invalid types
   */
  public static fromJson(json: unknown): CogitPushResponse {
    if (!json || typeof json !== 'object') {
      throw new TypeError('CogitPushResponse JSON must be an object')
    }

    const obj = json as Record<string, unknown>

    if (typeof obj.success !== 'boolean') {
      throw new TypeError('CogitPushResponse JSON must have a boolean success field')
    }

    // Handle snake_case from API: commit_sha -> commitSha
    const commitSha = obj.commit_sha ?? obj.commitSha
    if (typeof commitSha !== 'string') {
      throw new TypeError('CogitPushResponse JSON must have a string commit_sha field')
    }

    if (typeof obj.message !== 'string') {
      throw new TypeError('CogitPushResponse JSON must have a string message field')
    }

    return new CogitPushResponse({
      commitSha,
      message: obj.message,
      success: obj.success,
    })
  }
}
