import {expect} from 'chai'

import {formatTaskError, formatTransportError} from '../../../../src/tui/utils/error-messages.js'

describe('error-messages', () => {
  describe('formatTransportError', () => {
    it('returns /vc init hint for ERR_VC_GIT_NOT_INITIALIZED', () => {
      const err = Object.assign(new Error('ByteRover version control not initialized.'), {
        code: 'ERR_VC_GIT_NOT_INITIALIZED',
      })
      expect(formatTransportError(err)).to.equal('ByteRover version control not initialized. Run /vc init first.')
    })

    it('returns /vc add hint for ERR_VC_NOTHING_STAGED', () => {
      const err = Object.assign(new Error('Nothing staged.'), {code: 'ERR_VC_NOTHING_STAGED'})
      expect(formatTransportError(err)).to.equal('Nothing staged. Run /vc add first.')
    })

    it('falls through to server hint for ERR_VC_USER_NOT_CONFIGURED (authenticated)', () => {
      const err = Object.assign(
        new Error(
          `Commit author not configured. Run: brv vc config user.name "bao@b.dev" and brv vc config user.email "bao@b.dev". for event 'vc:commit'`,
        ),
        {code: 'ERR_VC_USER_NOT_CONFIGURED'},
      )
      expect(formatTransportError(err)).to.equal(
        'Commit author not configured. Run: brv vc config user.name "bao@b.dev" and brv vc config user.email "bao@b.dev".',
      )
    })

    it('falls through to server hint for ERR_VC_USER_NOT_CONFIGURED (not authenticated)', () => {
      const err = Object.assign(
        new Error(
          `Commit author not configured. Run: brv vc config user.name <value> and brv vc config user.email <value>. for event 'vc:commit'`,
        ),
        {code: 'ERR_VC_USER_NOT_CONFIGURED'},
      )
      expect(formatTransportError(err)).to.equal(
        'Commit author not configured. Run: brv vc config user.name <value> and brv vc config user.email <value>.',
      )
    })

    it('returns multi-line cloud guidance for ERR_VC_NO_REMOTE', () => {
      const err = Object.assign(new Error('No remote configured.'), {code: 'ERR_VC_NO_REMOTE'})
      const result = formatTransportError(err)
      expect(result).to.include('No remote configured.')
      expect(result).to.include('To connect to cloud:')
      expect(result).to.match(/https:\/\/.*app\.byterover\.dev/)
      expect(result).to.include('Copy the remote URL')
      expect(result).to.include('/vc remote add origin <url>')
      expect(result).to.include('/vc push -u origin main')
    })

    it('returns /vc pull hint for ERR_VC_NON_FAST_FORWARD', () => {
      const err = Object.assign(new Error('Remote has changes.'), {code: 'ERR_VC_NON_FAST_FORWARD'})
      expect(formatTransportError(err)).to.equal('Remote has changes. Run /vc pull first.')
    })

    it('returns /login hint for ERR_VC_AUTH_FAILED', () => {
      const err = Object.assign(new Error('Authentication failed. Run /login.'), {code: 'ERR_VC_AUTH_FAILED'})
      expect(formatTransportError(err)).to.equal('Authentication failed. Run /login.')
    })

    it('returns raw message for unknown error code', () => {
      const err = Object.assign(new Error('Something went wrong.'), {code: 'ERR_UNKNOWN_CODE'})
      expect(formatTransportError(err)).to.equal('Something went wrong.')
    })

    it('strips " for event \'...\'" suffix from raw messages', () => {
      const err = new Error("Something went wrong. for event 'vc:commit'")
      expect(formatTransportError(err)).to.equal('Something went wrong.')
    })

    it('returns stringified value for non-Error input', () => {
      expect(formatTransportError('plain string error')).to.equal('plain string error')
      expect(formatTransportError(42)).to.equal('42')
    })

    it('returns raw message when error has no code property', () => {
      const err = new Error('No code here.')
      expect(formatTransportError(err)).to.equal('No code here.')
    })

    it('should return friendly message for TransportRequestTimeoutError', () => {
      const error = new Error("Request timeout for event 'provider:awaitOAuthCallback' after 300000ms")
      error.name = 'TransportRequestTimeoutError'
      expect(formatTransportError(error)).to.equal('Request timed out. Please try again.')
    })

    it('should strip event name and timeout suffix from transport errors', () => {
      const error = new Error("Something failed for event 'test:event' after 5000ms")
      expect(formatTransportError(error)).to.equal('Something failed')
    })
  })

  describe('formatTaskError', () => {
    it('returns /vc init hint for ERR_VC_GIT_NOT_INITIALIZED', () => {
      expect(
        formatTaskError({code: 'ERR_VC_GIT_NOT_INITIALIZED', message: 'ByteRover version control not initialized.'}),
      ).to.equal('ByteRover version control not initialized. Run /vc init first.')
    })

    it('returns /vc add hint for ERR_VC_NOTHING_STAGED', () => {
      expect(formatTaskError({code: 'ERR_VC_NOTHING_STAGED', message: 'Nothing staged.'})).to.equal(
        'Nothing staged. Run /vc add first.',
      )
    })

    it('returns raw message for unknown code', () => {
      expect(formatTaskError({code: 'ERR_SOMETHING_ELSE', message: 'Raw message.'})).to.equal('Raw message.')
    })

    it('returns raw message when no code provided', () => {
      expect(formatTaskError({message: 'No code.'})).to.equal('No code.')
    })

    it('returns empty string for undefined input', () => {
      expect(formatTaskError()).to.equal('')
    })
  })
})
