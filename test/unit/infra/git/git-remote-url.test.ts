import {expect} from 'chai'

import {buildCogitRemoteUrl} from '../../../../src/server/infra/git/cogit-url.js'

const FAKE_BASE = 'https://fake-cgit.example.com'

describe('buildCogitRemoteUrl', () => {
  it('should build correct URL from base + teamId + spaceId', () => {
    const url = buildCogitRemoteUrl(FAKE_BASE, 'team-123', 'space-456')
    expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
  })

  it('should trim trailing slash from base URL', () => {
    const url = buildCogitRemoteUrl(`${FAKE_BASE}/`, 'team-123', 'space-456')
    expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
    // Verify no double slash after trimming (excluding protocol)
    expect(url.replace('https://', '')).to.not.include('//')
  })

  it('should handle teamId and spaceId with hyphens and numbers', () => {
    const url = buildCogitRemoteUrl(FAKE_BASE, 'team-abc-123', 'space-xyz-789')
    expect(url).to.equal(`${FAKE_BASE}/git/team-abc-123/space-xyz-789.git`)
  })

  it('should always end with .git', () => {
    const url = buildCogitRemoteUrl(FAKE_BASE, 'any-team', 'any-space')
    expect(url).to.match(/\.git$/)
  })
})
