import {expect} from 'chai'

import {isSafeHttpUrl} from '../../../../../../src/webui/features/auth/utils/is-safe-http-url'

describe('isSafeHttpUrl', () => {
  it('returns true for https URLs', () => {
    expect(isSafeHttpUrl('https://byterover.dev/oauth/authorize?code=abc')).to.be.true
  })

  it('returns true for http URLs', () => {
    expect(isSafeHttpUrl('http://localhost:3000/callback')).to.be.true
  })

  it('returns false for javascript: URLs', () => {
    // eslint-disable-next-line no-script-url
    expect(isSafeHttpUrl('javascript:alert(1)')).to.be.false
  })

  it('returns false for data: URLs', () => {
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).to.be.false
  })

  it('returns false for file: URLs', () => {
    expect(isSafeHttpUrl('file:///etc/passwd')).to.be.false
  })

  it('returns false for malformed strings', () => {
    expect(isSafeHttpUrl('not-a-url')).to.be.false
    expect(isSafeHttpUrl('')).to.be.false
  })
})
