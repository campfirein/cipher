import {expect} from 'chai'

import {formatOverwriteMessage} from '../../../../src/server/infra/git/git-error-messages.js'

describe('formatOverwriteMessage', () => {
  it('produces the merge wording with tab-indented file list', () => {
    const message = formatOverwriteMessage('merge', ['a.md', 'notes/b.md'])
    expect(message).to.equal(
      'Your local changes to the following files would be overwritten by merge:\n' +
        '\ta.md\n' +
        '\tnotes/b.md\n' +
        'Please commit or discard your changes before you merge.',
    )
  })

  it('produces the checkout wording with tab-indented file list', () => {
    const message = formatOverwriteMessage('checkout', ['a.md'])
    expect(message).to.equal(
      'Your local changes to the following files would be overwritten by checkout:\n' +
        '\ta.md\n' +
        'Please commit or discard your changes before you switch branches.',
    )
  })

  it('produces the pull wording (operation defaults its own action verb)', () => {
    expect(formatOverwriteMessage('pull', ['a.md'])).to.equal(
      'Your local changes to the following files would be overwritten by pull:\n' +
        '\ta.md\n' +
        'Please commit or discard your changes before you pull.',
    )
  })

  it('produces a no-list form when caller has no file paths (CheckoutConflictError fallback)', () => {
    expect(formatOverwriteMessage('merge', [])).to.equal(
      'Your local changes would be overwritten by merge. Please commit or discard your changes before you merge.',
    )
    expect(formatOverwriteMessage('checkout', [])).to.equal(
      'Your local changes would be overwritten by checkout. Please commit or discard your changes before you switch branches.',
    )
    expect(formatOverwriteMessage('pull', [])).to.equal(
      'Your local changes would be overwritten by pull. Please commit or discard your changes before you pull.',
    )
  })

  it('contains the "would be overwritten" anchor that vc-handler error mapping greps for', () => {
    expect(formatOverwriteMessage('merge', ['x'])).to.include('would be overwritten')
    expect(formatOverwriteMessage('checkout', ['x'])).to.include('would be overwritten')
    expect(formatOverwriteMessage('merge', [])).to.include('would be overwritten')
    expect(formatOverwriteMessage('checkout', [])).to.include('would be overwritten')
  })

  it('points the user at the discard escape hatch (brv vc reset), not stash (brv has none)', () => {
    expect(formatOverwriteMessage('merge', ['x'])).to.include('discard')
    expect(formatOverwriteMessage('checkout', ['x'])).to.include('discard')
    expect(formatOverwriteMessage('merge', ['x'])).to.not.include('stash')
    expect(formatOverwriteMessage('checkout', ['x'])).to.not.include('stash')
  })
})
