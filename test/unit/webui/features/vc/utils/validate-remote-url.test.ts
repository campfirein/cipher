import {expect} from 'chai'

import {validateRemoteUrl} from '../../../../../../src/webui/features/vc/utils/validate-remote-url'

describe('validateRemoteUrl', () => {
  it('accepts a bare https URL', () => {
    expect(validateRemoteUrl('https://github.com/wzlng/repo.git')).to.be.undefined
  })

  it('rejects plain http URLs with a specific message', () => {
    expect(validateRemoteUrl('http://self-hosted.internal/repo.git')).to.equal(
      "Plain HTTP isn't supported — use an HTTPS URL.",
    )
  })

  it('trims surrounding whitespace before validating', () => {
    expect(validateRemoteUrl('  https://github.com/wzlng/repo.git  ')).to.be.undefined
  })

  it('rejects empty/whitespace-only input', () => {
    expect(validateRemoteUrl('')).to.equal('URL is required.')
    expect(validateRemoteUrl('   ')).to.equal('URL is required.')
  })

  it('rejects scp-style ssh urls with a specific message', () => {
    expect(validateRemoteUrl('git@github.com:wzlng/repo.git')).to.equal(
      "SSH remotes aren't supported yet — use an HTTPS URL.",
    )
  })

  it('rejects ssh:// urls with a specific message', () => {
    expect(validateRemoteUrl('ssh://git@github.com/wzlng/repo.git')).to.equal(
      "SSH remotes aren't supported yet — use an HTTPS URL.",
    )
  })

  it('rejects git:// urls', () => {
    expect(validateRemoteUrl('git://github.com/wzlng/repo.git')).to.equal(
      'Expected an HTTPS URL (e.g. https://byterover.dev/team/space.git).',
    )
  })

  it('rejects malformed non-URL strings', () => {
    expect(validateRemoteUrl('foo/bar/repo')).to.equal(
      'Expected an HTTPS URL (e.g. https://byterover.dev/team/space.git).',
    )
  })
})
