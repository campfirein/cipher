/**
 * Represents an authentication token with access and refresh tokens, expiration, and type.
 */
export class AuthToken {
  /**
   * Authorization header, bearer token.
   */
  public readonly accessToken: string
  public readonly expiresAt: Date
  public readonly refreshToken: string
  public readonly tokenType: string

  // TODO: Do we need to store session_key?

  public constructor(accessToken: string, refreshToken: string, expiresAt: Date, tokenType: string = 'Bearer') {
    this.accessToken = accessToken
    this.expiresAt = expiresAt
    this.refreshToken = refreshToken
    this.tokenType = tokenType
  }

  /**
   * Create an AuthToken instance from a JSON object.
   * @param json JSON object representing the AuthToken
   * @returns An instance of AuthToken
   */
  public static fromJSON(json: Record<string, string>): AuthToken {
    return new AuthToken(json.accessToken, json.refreshToken, new Date(json.expiresAt), json.tokenType)
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
  public toJSON(): Record<string, string> {
    return {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt.toISOString(),
      refreshToken: this.refreshToken,
      tokenType: this.tokenType,
    }
  }
}
