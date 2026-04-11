import {expect} from 'chai'

import {buildCogitRemoteUrl, parseUserFacingUrl} from '../../../../src/server/infra/git/cogit-url.js'

const FAKE_BASE = 'https://fake-cgit.example.com'

describe('cogit-url', () => {
  describe('buildCogitRemoteUrl', () => {
    it('should build correct URL from base + teamName + spaceName', () => {
      const url = buildCogitRemoteUrl(FAKE_BASE, 'team-123', 'space-456')
      expect(url).to.equal(`${FAKE_BASE}/team-123/space-456.git`)
    })

    it('should trim trailing slash from base URL', () => {
      const url = buildCogitRemoteUrl(`${FAKE_BASE}/`, 'team-123', 'space-456')
      expect(url).to.equal(`${FAKE_BASE}/team-123/space-456.git`)
      expect(url.replace('https://', '')).to.not.include('//')
    })

    it('should handle teamName and spaceName with hyphens and numbers', () => {
      const url = buildCogitRemoteUrl(FAKE_BASE, 'team-abc-123', 'space-xyz-789')
      expect(url).to.equal(`${FAKE_BASE}/team-abc-123/space-xyz-789.git`)
    })

    it('should always end with .git', () => {
      const url = buildCogitRemoteUrl(FAKE_BASE, 'any-team', 'any-space')
      expect(url).to.match(/\.git$/)
    })
  })

  describe('parseUserFacingUrl', () => {
    it('should extract teamName and spaceName from valid .git URL', () => {
      const result = parseUserFacingUrl('https://byterover.dev/acme/project.git')
      expect(result).to.deep.equal({spaceName: 'project', teamName: 'acme'})
    })

    it('should handle names with hyphens', () => {
      const result = parseUserFacingUrl('https://byterover.dev/my-team/my-space.git')
      expect(result).to.deep.equal({spaceName: 'my-space', teamName: 'my-team'})
    })

    it('should return null for URL without .git extension', () => {
      expect(parseUserFacingUrl('https://byterover.dev/acme/project')).to.be.null
    })

    it('should return null for .brv URL', () => {
      expect(parseUserFacingUrl('https://byterover.dev/acme/project.brv')).to.be.null
    })

    it('should return null for invalid URL', () => {
      expect(parseUserFacingUrl('not-a-url')).to.be.null
    })
  })
})
