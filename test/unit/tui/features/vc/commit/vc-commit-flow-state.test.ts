import {expect} from 'chai'

import {VcErrorCode} from '../../../../../../src/shared/transport/events/vc-events.js'
import {
  type CommitFlowState,
  initialCommitFlowState,
  MAX_PASSPHRASE_RETRIES,
  reduceCommitFlow,
} from '../../../../../../src/tui/features/vc/commit/components/vc-commit-flow-state.js'

function errorWithCode(code: string): Error & {code: string} {
  const err = new Error('Simulated transport error') as Error & {code: string}
  err.code = code
  return err
}

describe('reduceCommitFlow()', () => {
  describe('from initial (committing, attempt 0)', () => {
    it('commit-success → done(success) with formatted SHA + message + unsigned tag', () => {
      const result = reduceCommitFlow(initialCommitFlowState, {
        message: 'hello',
        sha: 'abcdef1234567890',
        type: 'commit-success',
      })

      expect(result).to.deep.equal({
        kind: 'done',
        message: '[abcdef1] hello',
        outcome: 'success',
      })
    })

    it('commit-success with signed:true includes the signing indicator', () => {
      const result = reduceCommitFlow(initialCommitFlowState, {
        message: 'signed msg',
        sha: 'deadbeefcafe',
        signed: true,
        type: 'commit-success',
      })

      expect(result.kind).to.equal('done')
      if (result.kind !== 'done') throw new Error('unreachable')
      expect(result.message).to.equal('[deadbee] signed msg (signed)')
    })

    it('commit-error with PASSPHRASE_REQUIRED → awaiting-passphrase(attempt=1)', () => {
      const result = reduceCommitFlow(initialCommitFlowState, {
        error: errorWithCode(VcErrorCode.PASSPHRASE_REQUIRED),
        type: 'commit-error',
      })

      expect(result).to.deep.equal({attempt: 1, kind: 'awaiting-passphrase'})
    })

    it('commit-error with a non-passphrase code → done(error)', () => {
      const result = reduceCommitFlow(initialCommitFlowState, {
        error: errorWithCode('SOMETHING_ELSE'),
        type: 'commit-error',
      })

      expect(result.kind).to.equal('done')
      if (result.kind !== 'done') throw new Error('unreachable')
      expect(result.outcome).to.equal('error')
      expect(result.message).to.match(/Failed to commit/)
    })
  })

  describe('from awaiting-passphrase', () => {
    const awaiting: CommitFlowState = {attempt: 1, kind: 'awaiting-passphrase'}

    it('passphrase-submitted → committing (attempt preserved)', () => {
      const result = reduceCommitFlow(awaiting, {type: 'passphrase-submitted'})
      expect(result).to.deep.equal({attempt: 1, kind: 'committing'})
    })

    it('passphrase-cancelled → done(cancelled)', () => {
      const result = reduceCommitFlow(awaiting, {type: 'passphrase-cancelled'})
      expect(result).to.deep.equal({
        kind: 'done',
        message: 'Passphrase entry cancelled.',
        outcome: 'cancelled',
      })
    })
  })

  describe('retry cap', () => {
    it('PASSPHRASE_REQUIRED after MAX_PASSPHRASE_RETRIES attempts → done(error, "Too many failed…")', () => {
      const atCap: CommitFlowState = {attempt: MAX_PASSPHRASE_RETRIES, kind: 'committing'}
      const result = reduceCommitFlow(atCap, {
        error: errorWithCode(VcErrorCode.PASSPHRASE_REQUIRED),
        type: 'commit-error',
      })

      expect(result.kind).to.equal('done')
      if (result.kind !== 'done') throw new Error('unreachable')
      expect(result.outcome).to.equal('error')
      expect(result.message).to.match(/Too many failed passphrase attempts/)
      expect(result.message).to.include(String(MAX_PASSPHRASE_RETRIES))
    })

    it('PASSPHRASE_REQUIRED at attempt < MAX → back to awaiting-passphrase (attempt+1)', () => {
      const belowCap: CommitFlowState = {attempt: 1, kind: 'committing'}
      const result = reduceCommitFlow(belowCap, {
        error: errorWithCode(VcErrorCode.PASSPHRASE_REQUIRED),
        type: 'commit-error',
      })

      expect(result).to.deep.equal({attempt: 2, kind: 'awaiting-passphrase'})
    })
  })

  describe('terminal state is absorbing', () => {
    const done: CommitFlowState = {kind: 'done', message: 'x', outcome: 'success'}

    it('ignores commit-success once done', () => {
      const result = reduceCommitFlow(done, {
        message: 'new',
        sha: '1234567890',
        type: 'commit-success',
      })
      expect(result).to.equal(done)
    })

    it('ignores commit-error once done', () => {
      const result = reduceCommitFlow(done, {error: new Error('x'), type: 'commit-error'})
      expect(result).to.equal(done)
    })

    it('ignores passphrase events once done', () => {
      expect(reduceCommitFlow(done, {type: 'passphrase-submitted'})).to.equal(done)
      expect(reduceCommitFlow(done, {type: 'passphrase-cancelled'})).to.equal(done)
    })
  })

  describe('out-of-order events are no-ops', () => {
    it('passphrase-submitted while committing → unchanged', () => {
      const committing: CommitFlowState = {attempt: 0, kind: 'committing'}
      const result = reduceCommitFlow(committing, {type: 'passphrase-submitted'})
      expect(result).to.equal(committing)
    })

    it('passphrase-cancelled while committing → unchanged', () => {
      const committing: CommitFlowState = {attempt: 0, kind: 'committing'}
      const result = reduceCommitFlow(committing, {type: 'passphrase-cancelled'})
      expect(result).to.equal(committing)
    })
  })
})
