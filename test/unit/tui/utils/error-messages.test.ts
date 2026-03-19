import {expect} from 'chai'

import {formatTransportError} from '../../../../src/tui/utils/error-messages.js'

describe('formatTransportError', () => {
  it('should return friendly message for TransportRequestTimeoutError', () => {
    const error = new Error("Request timeout for event 'provider:awaitOAuthCallback' after 300000ms")
    error.name = 'TransportRequestTimeoutError'

    expect(formatTransportError(error)).to.equal('Request timed out. Please try again.')
  })

  it('should strip event name and timeout suffix from transport errors', () => {
    const error = new Error("Something failed for event 'test:event' after 5000ms")

    expect(formatTransportError(error)).to.equal('Something failed')
  })

  it('should strip event name suffix without timeout', () => {
    const error = new Error("Something failed for event 'test:event'")

    expect(formatTransportError(error)).to.equal('Something failed')
  })

  it('should return string representation for non-Error values', () => {
    expect(formatTransportError('plain string')).to.equal('plain string')
  })

  it('should return raw message when no pattern matches', () => {
    const error = new Error('Some other error')

    expect(formatTransportError(error)).to.equal('Some other error')
  })
})
