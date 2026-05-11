import {expect} from 'chai'

import {
  CHANNEL_ERROR_CODE,
  ChannelAlreadyExistsError,
  ChannelArchivedError,
  ChannelError,
  ChannelInvalidCursorError,
  ChannelInvalidRequestError,
  ChannelNotFoundError,
  ChannelPromptEmptyError,
  ChannelTurnNotFoundError,
  ChannelUnauthorizedError,
} from '../../../../../../src/server/core/domain/channel/errors.js'

// Slice 1.3 — channel error hierarchy.
// Every Phase-1 error code from CHANNEL_PROTOCOL.md §11 is reachable as a
// concrete subclass of ChannelError whose `.code` returns the canonical wire
// code. Channel-handler.ts (Slice 1.4) maps these subclasses onto the
// transport error envelope.
describe('ChannelError hierarchy (Slice 1.3 / Phase 1)', () => {
  it('exports the canonical wire codes as a CHANNEL_ERROR_CODE map', () => {
    expect(CHANNEL_ERROR_CODE.UNAUTHORIZED).to.equal('CHANNEL_UNAUTHORIZED')
    expect(CHANNEL_ERROR_CODE.INVALID_REQUEST).to.equal('CHANNEL_INVALID_REQUEST')
    expect(CHANNEL_ERROR_CODE.NOT_FOUND).to.equal('CHANNEL_NOT_FOUND')
    expect(CHANNEL_ERROR_CODE.ALREADY_EXISTS).to.equal('CHANNEL_ALREADY_EXISTS')
    expect(CHANNEL_ERROR_CODE.ARCHIVED).to.equal('CHANNEL_ARCHIVED')
    expect(CHANNEL_ERROR_CODE.INVALID_CURSOR).to.equal('CHANNEL_INVALID_CURSOR')
    expect(CHANNEL_ERROR_CODE.PROMPT_EMPTY).to.equal('CHANNEL_PROMPT_EMPTY')
    expect(CHANNEL_ERROR_CODE.TURN_NOT_FOUND).to.equal('CHANNEL_TURN_NOT_FOUND')
  })

  it('ChannelUnauthorizedError exposes the canonical wire code', () => {
    const err = new ChannelUnauthorizedError('missing token')
    expect(err).to.be.instanceOf(ChannelError)
    expect(err).to.be.instanceOf(Error)
    expect(err.code).to.equal('CHANNEL_UNAUTHORIZED')
    expect(err.message).to.include('missing token')
    expect(err.name).to.equal('ChannelUnauthorizedError')
  })

  it('ChannelInvalidRequestError carries structured validation details', () => {
    const issues = {fieldErrors: {channelId: ['Required']}}
    const err = new ChannelInvalidRequestError('payload failed validation', issues)
    expect(err.code).to.equal('CHANNEL_INVALID_REQUEST')
    expect(err.details).to.deep.equal(issues)
  })

  it('ChannelNotFoundError binds the missing channelId on the error', () => {
    const err = new ChannelNotFoundError('pi-missing')
    expect(err.code).to.equal('CHANNEL_NOT_FOUND')
    expect(err.channelId).to.equal('pi-missing')
    expect(err.message).to.include('pi-missing')
  })

  it('ChannelAlreadyExistsError binds the conflicting channelId', () => {
    const err = new ChannelAlreadyExistsError('pi-test')
    expect(err.code).to.equal('CHANNEL_ALREADY_EXISTS')
    expect(err.channelId).to.equal('pi-test')
  })

  it('ChannelArchivedError binds the channelId', () => {
    const err = new ChannelArchivedError('pi-old')
    expect(err.code).to.equal('CHANNEL_ARCHIVED')
    expect(err.channelId).to.equal('pi-old')
  })

  it('ChannelInvalidCursorError exposes the offending cursor', () => {
    const err = new ChannelInvalidCursorError('not-a-cursor')
    expect(err.code).to.equal('CHANNEL_INVALID_CURSOR')
    expect(err.cursor).to.equal('not-a-cursor')
  })

  it('ChannelPromptEmptyError surfaces a message pointing at §8.4 normalisation', () => {
    const err = new ChannelPromptEmptyError()
    expect(err.code).to.equal('CHANNEL_PROMPT_EMPTY')
    expect(err.message).to.match(/prompt/i)
  })

  it('ChannelTurnNotFoundError binds (channelId, turnId)', () => {
    const err = new ChannelTurnNotFoundError('pi-test', '01HX')
    expect(err.code).to.equal('CHANNEL_TURN_NOT_FOUND')
    expect(err.channelId).to.equal('pi-test')
    expect(err.turnId).to.equal('01HX')
  })

  it('every Phase-1 error is also a ChannelError (so handler maps a single type)', () => {
    expect(new ChannelUnauthorizedError('x')).to.be.instanceOf(ChannelError)
    expect(new ChannelInvalidRequestError('x', {})).to.be.instanceOf(ChannelError)
    expect(new ChannelNotFoundError('x')).to.be.instanceOf(ChannelError)
    expect(new ChannelAlreadyExistsError('x')).to.be.instanceOf(ChannelError)
    expect(new ChannelArchivedError('x')).to.be.instanceOf(ChannelError)
    expect(new ChannelInvalidCursorError('x')).to.be.instanceOf(ChannelError)
    expect(new ChannelPromptEmptyError()).to.be.instanceOf(ChannelError)
    expect(new ChannelTurnNotFoundError('x', 'y')).to.be.instanceOf(ChannelError)
  })
})
