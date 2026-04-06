import {expect} from 'chai'

import {
  buildCogitRemoteUrl,
  parseGitPathUrl,
  parseUserFacingUrl,
  stripCredentialsFromUrl,
} from '../../../../src/server/infra/git/cogit-url.js'

const FAKE_BASE = 'https://fake-cgit.example.com'

describe('cogit-url', () => {
  describe('buildCogitRemoteUrl', () => {
    it('should build correct URL from base + teamId + spaceId', () => {
      const url = buildCogitRemoteUrl(FAKE_BASE, 'team-123', 'space-456')
      expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
    })

    it('should trim trailing slash from base URL', () => {
      const url = buildCogitRemoteUrl(`${FAKE_BASE}/`, 'team-123', 'space-456')
      expect(url).to.equal(`${FAKE_BASE}/git/team-123/space-456.git`)
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

  describe('stripCredentialsFromUrl', () => {
    it('should remove credentials from URL', () => {
      const result = stripCredentialsFromUrl('https://user:pass@example.com/git/team/space.git')
      expect(result).to.equal('https://example.com/git/team/space.git')
    })

    it('should return unchanged URL if no credentials', () => {
      const url = 'https://example.com/git/team/space.git'
      expect(stripCredentialsFromUrl(url)).to.equal(url)
    })

    it('should return unchanged string for invalid URL', () => {
      expect(stripCredentialsFromUrl('not-a-url')).to.equal('not-a-url')
    })
  })

  describe('parseGitPathUrl', () => {
    it('should extract segments from .git URL and detect non-UUID names', () => {
      const result = parseGitPathUrl('https://dev-beta-cgit.byterover.dev/git/team-123/space-456.git')
      expect(result).to.deep.equal({areUuids: false, segment1: 'team-123', segment2: 'space-456'})
    })

    it('should detect UUID-style IDs', () => {
      const result = parseGitPathUrl(
        'https://dev-beta-cgit.byterover.dev/git/019b6b1f-38b4-7932-868c-3fa137fd4327/019b6b1f-62d7-7464-b654-72c69c71746b.git',
      )
      expect(result).to.not.be.null
      expect(result!.areUuids).to.be.true
      expect(result!.segment1).to.equal('019b6b1f-38b4-7932-868c-3fa137fd4327')
      expect(result!.segment2).to.equal('019b6b1f-62d7-7464-b654-72c69c71746b')
    })

    it('should work with credentials in URL', () => {
      const result = parseGitPathUrl('https://user:pass@dev-beta-cgit.byterover.dev/git/team-1/space-2.git')
      expect(result).to.deep.equal({areUuids: false, segment1: 'team-1', segment2: 'space-2'})
    })

    it('should return null for .brv extension in /git/ path', () => {
      expect(parseGitPathUrl('https://dev-beta-cgit.byterover.dev/git/Team2/test-git.brv')).to.be.null
    })

    it('should return null for non-cogit URL', () => {
      expect(parseGitPathUrl('https://example.com/repo.git')).to.be.null
    })

    it('should return null for invalid URL', () => {
      expect(parseGitPathUrl('not-a-url')).to.be.null
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

    it('should return null for cogit URL with /git/ prefix', () => {
      expect(parseUserFacingUrl('https://example.com/git/team/space.git')).to.be.null
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
