import {expect} from 'chai'
import {stub} from 'sinon'

import type {IAuthStateStore} from '../../../../src/server/core/interfaces/state/i-auth-state-store.js'

import {IsomorphicGitService} from '../../../../src/server/infra/git/isomorphic-git-service.js'

const createService = (baseUrl: string) => {
  const mockAuth = {
    getToken: stub(),
    loadToken: stub().resolves(),
    onAuthChanged: stub(),
    onAuthExpired: stub(),
    startPolling: stub(),
    stopPolling: stub(),
  } as unknown as IAuthStateStore

  return new IsomorphicGitService(mockAuth, {cogitGitBaseUrl: baseUrl})
}

describe('IsomorphicGitService.buildCogitRemoteUrl', () => {
  it('should build correct URL for prod', () => {
    const service = createService('https://v3-cgit.byterover.dev')
    const url = service.buildCogitRemoteUrl('team-123', 'space-456')
    expect(url).to.equal('https://v3-cgit.byterover.dev/git/team-123/space-456.git')
  })

  it('should build correct URL for dev', () => {
    const service = createService('https://dev-beta-cgit.byterover.dev')
    const url = service.buildCogitRemoteUrl('my-team', 'my-space')
    expect(url).to.equal('https://dev-beta-cgit.byterover.dev/git/my-team/my-space.git')
  })

  it('should trim trailing slash from base URL', () => {
    const service = createService('https://v3-cgit.byterover.dev/')
    const url = service.buildCogitRemoteUrl('team-123', 'space-456')
    expect(url).to.equal('https://v3-cgit.byterover.dev/git/team-123/space-456.git')
    // Verify no double slash after trimming (excluding protocol)
    expect(url.replace('https://', '')).to.not.include('//')
  })

  it('should handle teamId and spaceId with hyphens and numbers', () => {
    const service = createService('https://v3-cgit.byterover.dev')
    const url = service.buildCogitRemoteUrl('team-abc-123', 'space-xyz-789')
    expect(url).to.equal('https://v3-cgit.byterover.dev/git/team-abc-123/space-xyz-789.git')
  })

  it('should always end with .git', () => {
    const service = createService('https://v3-cgit.byterover.dev')
    const url = service.buildCogitRemoteUrl('any-team', 'any-space')
    expect(url).to.match(/\.git$/)
  })
})
