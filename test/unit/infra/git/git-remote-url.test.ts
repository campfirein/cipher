import {expect} from 'chai'

import type {IAuthStateStore} from '../../../../src/server/core/interfaces/state/i-auth-state-store.js'

import {IsomorphicGitService} from '../../../../src/server/infra/git/isomorphic-git-service.js'

const FAKE_BASE = 'https://fake-cgit.example.com'

// buildCogitRemoteUrl() is a pure string operation — does not touch authStateStore
const createService = (baseUrl: string) => {
  const mockAuth = {} as unknown as IAuthStateStore
  return new IsomorphicGitService(mockAuth, {cogitGitBaseUrl: baseUrl})
}

describe('IsomorphicGitService.buildCogitRemoteUrl', () => {
  it('should build correct URL from base + teamId + spaceId', () => {
    const service = createService(FAKE_BASE)
    const url = service.buildCogitRemoteUrl('team-123', 'space-456')
    expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
  })

  it('should trim trailing slash from base URL', () => {
    const service = createService(`${FAKE_BASE}/`)
    const url = service.buildCogitRemoteUrl('team-123', 'space-456')
    expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
    // Verify no double slash after trimming (excluding protocol)
    expect(url.replace('https://', '')).to.not.include('//')
  })

  it('should handle teamId and spaceId with hyphens and numbers', () => {
    const service = createService(FAKE_BASE)
    const url = service.buildCogitRemoteUrl('team-abc-123', 'space-xyz-789')
    expect(url).to.equal(`${FAKE_BASE}/git/team-abc-123/space-xyz-789.git`)
  })

  it('should always end with .git', () => {
    const service = createService(FAKE_BASE)
    const url = service.buildCogitRemoteUrl('any-team', 'any-space')
    expect(url).to.match(/\.git$/)
  })
})
