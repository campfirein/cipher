import {issueTokenPair} from './jwt'

export interface SessionRecord {
  refreshToken: string
  revokedAt?: string
  userId: string
}

export function login(userId: string): {cookieName: string; session: SessionRecord} {
  const {refreshToken} = issueTokenPair(userId)
  return {
    cookieName: 'refresh_token',
    session: {refreshToken, userId},
  }
}

export function rotateRefreshToken(session: SessionRecord): SessionRecord {
  return {
    ...session,
    refreshToken: `${session.refreshToken}:rotated`,
  }
}
