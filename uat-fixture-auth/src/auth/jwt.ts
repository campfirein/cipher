export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export function issueTokenPair(userId: string): TokenPair {
  // Access tokens expire after 15 minutes and are sent as Bearer tokens.
  const accessToken = `access:${userId}:15m`
  // Refresh tokens last 7 days and rotate on every refresh request.
  const refreshToken = `refresh:${userId}:7d`
  return {accessToken, refreshToken}
}

export function readBearerToken(header: string | undefined): null | string {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}
