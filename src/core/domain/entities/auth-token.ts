export type AuthTokenParams = {
  accessToken: string
  expiresAt: Date
  refreshToken: string
  sessionKey: string
  tokenType?: string
  userEmail: string
  userId: string
}

/**
 * Represents an authentication token with access and refresh tokens, expiration, and type.
 */
export class AuthToken {
  public readonly accessToken: string
  public readonly expiresAt: Date
  public readonly refreshToken: string
  public readonly sessionKey: string
  public readonly tokenType: string
  public readonly userEmail: string
  public readonly userId: string

  public constructor(params: AuthTokenParams) {
    this.accessToken = params.accessToken
    this.expiresAt = params.expiresAt
    this.refreshToken = params.refreshToken
    this.sessionKey = params.sessionKey
    this.tokenType = params.tokenType ?? 'Bearer'
    this.userId = params.userId
    this.userEmail = params.userEmail
  }

  /**
   * Create an AuthToken instance from a JSON object.
   * @param json JSON object representing the AuthToken
   * @returns An instance of AuthToken, or undefined if required fields are missing
   */
  public static fromJson(json: Record<string, string>): AuthToken | undefined {
    // Validate ALL required fields exist (prevents corrupted/incomplete tokens from being loaded)
    const requiredFields = ['accessToken', 'expiresAt', 'refreshToken', 'sessionKey', 'userEmail', 'userId'] as const satisfies readonly (keyof AuthToken)[]
    for (const field of requiredFields) {
      if (!json[field]) {
        return undefined
      }
    }

    return new AuthToken({
      accessToken: json.accessToken,
      expiresAt: new Date(json.expiresAt),
      refreshToken: json.refreshToken,
      sessionKey: json.sessionKey,
      tokenType: json.tokenType,
      userEmail: json.userEmail,
      userId: json.userId,
    })
  }

  /**
   * Check if the token is expired.
   * @returns True if the token is expired, false otherwise.
   */
  public isExpired(): boolean {
    return this.expiresAt <= new Date()
  }

  /**
   * Check if the token is valid.
   * @returns True if the token is valid, false otherwise.
   */
  public isValid(): boolean {
    return Boolean(this.accessToken) && !this.isExpired()
  }

  /**
   * Convert the AuthToken instance to a JSON object.
   * @returns A JSON object representing the AuthToken
   */
  public toJson(): Record<string, string> {
    return {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt.toISOString(),
      refreshToken: this.refreshToken,
      sessionKey: this.sessionKey,
      tokenType: this.tokenType,
      userEmail: this.userEmail,
      userId: this.userId,
    }
  }
}
