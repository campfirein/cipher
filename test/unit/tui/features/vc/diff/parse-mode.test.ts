import {expect} from 'chai'

import {parseMode} from '../../../../../../src/tui/features/vc/diff/utils/parse-mode.js'

describe('parseMode', () => {
  it('returns unstaged when no arg and no --staged', () => {
    expect(parseMode(undefined, false)).to.deep.equal({kind: 'unstaged'})
  })

  it('returns staged when --staged is set', () => {
    expect(parseMode(undefined, true)).to.deep.equal({kind: 'staged'})
  })

  it('returns ref-vs-worktree for a single ref arg', () => {
    expect(parseMode('main', false)).to.deep.equal({kind: 'ref-vs-worktree', ref: 'main'})
    expect(parseMode('HEAD~1', false)).to.deep.equal({kind: 'ref-vs-worktree', ref: 'HEAD~1'})
  })

  it('returns range for two-dot syntax', () => {
    expect(parseMode('main..feature', false)).to.deep.equal({from: 'main', kind: 'range', to: 'feature'})
    expect(parseMode('HEAD~3..HEAD', false)).to.deep.equal({from: 'HEAD~3', kind: 'range', to: 'HEAD'})
  })

  it('rejects three-dot syntax (merge-base diff is not supported)', () => {
    expect(() => parseMode('main...feature', false)).to.throw(/three-dot/)
  })

  it('rejects --staged combined with a ref argument', () => {
    expect(() => parseMode('main', true)).to.throw(/--staged cannot be combined/)
  })
})
