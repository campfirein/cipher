import {expect} from 'chai'

import {decideRmRollbackAction} from '../../../../src/server/infra/git/isomorphic-git-service.js'

describe('decideRmRollbackAction', () => {
  it('noop: index entry never existed (nothing to rebuild)', () => {
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: false, headExists: false, indexExisted: false}),
    ).to.equal('noop')
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: true, headExists: true, indexExisted: false}),
    ).to.equal('noop')
  })

  it('reset-index: HEAD exists — restore the INDEX entry from HEAD', () => {
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: false, headExists: true, indexExisted: true}),
    ).to.equal('reset-index')
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: true, headExists: true, indexExisted: true}),
    ).to.equal('reset-index')
  })

  it('re-add: pre-commit repo with workdir file present — re-stage it', () => {
    // Regression guard for B2: applies whether the file is on disk because
    // (a) we just restored it from snapshot (`!cached` path) or
    // (b) `cached` skipped the unlink step entirely.
    // The pure-function input is the same in both cases — `fileExistsInWorkdir: true`.
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: true, headExists: false, indexExisted: true}),
    ).to.equal('re-add')
  })

  it('fail: pre-commit repo and workdir file is gone (no way to rebuild index)', () => {
    expect(
      decideRmRollbackAction({fileExistsInWorkdir: false, headExists: false, indexExisted: true}),
    ).to.equal('fail')
  })
})
