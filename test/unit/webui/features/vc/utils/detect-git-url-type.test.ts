import {expect} from 'chai'

import {detectGitUrlType} from '../../../../../../src/webui/features/vc/utils/detect-git-url-type'

describe('detectGitUrlType', () => {
  it('detects https urls', () => {
    expect(detectGitUrlType('https://github.com/wzlng/byterover-cli.git')).to.equal('https')
  })

  it('detects http urls', () => {
    expect(detectGitUrlType('http://self-hosted.internal/repo.git')).to.equal('https')
  })

  it('detects ssh scheme urls', () => {
    expect(detectGitUrlType('ssh://git@github.com/wzlng/byterover-cli.git')).to.equal('ssh')
  })

  it('detects git@host:path scp-style urls as ssh', () => {
    expect(detectGitUrlType('git@github.com:wzlng/byterover-cli.git')).to.equal('ssh')
  })

  it('detects git:// urls', () => {
    expect(detectGitUrlType('git://github.com/wzlng/byterover-cli.git')).to.equal('git')
  })

  it('returns unknown for empty / malformed strings', () => {
    expect(detectGitUrlType('')).to.equal('unknown')
    expect(detectGitUrlType('not-a-url')).to.equal('unknown')
  })

  it('trims surrounding whitespace before detecting', () => {
    expect(detectGitUrlType('  git@github.com:foo/bar.git  ')).to.equal('ssh')
  })
})
