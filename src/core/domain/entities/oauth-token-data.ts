/**
 * Represents OAuth token data returned from the authorization server.
 * This is an intermediate type that does not include user information.
 * The login command will combine this with user data to create a complete AuthToken.
 */
export class OAuthTokenData {
  public readonly accessToken: string
  public readonly expiresAt: Date
  public readonly refreshToken: string
  public readonly sessionKey: string
  public readonly tokenType: string

  // eslint-disable-next-line max-params
  public constructor(
    accessToken: string,
    expiresAt: Date,
    refreshToken: string,
    sessionKey: string,
    tokenType: string = 'Bearer',
  ) {
    this.accessToken = accessToken
    this.expiresAt = expiresAt
    this.refreshToken = refreshToken
    this.sessionKey = sessionKey
    this.tokenType = tokenType
  }
}
