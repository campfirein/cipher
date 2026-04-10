/// <reference types="mocha" />

import {expect} from 'chai'

import {SwarmValidationError} from '../../../../src/agent/infra/swarm/errors.js'

describe('SwarmValidationError', () => {
  it('should be an instance of Error', () => {
    const err = new SwarmValidationError(['bad slug'])
    expect(err).to.be.instanceOf(Error)
  })

  it('should have name SwarmValidationError', () => {
    const err = new SwarmValidationError(['err1'])
    expect(err.name).to.equal('SwarmValidationError')
  })

  it('should store errors and warnings arrays', () => {
    const err = new SwarmValidationError(['err1', 'err2'], ['warn1'])
    expect(err.errors).to.deep.equal(['err1', 'err2'])
    expect(err.warnings).to.deep.equal(['warn1'])
  })

  it('should default warnings to empty array', () => {
    const err = new SwarmValidationError(['err1'])
    expect(err.warnings).to.deep.equal([])
  })

  it('should join errors into message', () => {
    const err = new SwarmValidationError(['err1', 'err2'])
    expect(err.message).to.equal('err1\nerr2')
  })

  it('should not include note in message', () => {
    const err = new SwarmValidationError(['err1'], [], 'some note')
    expect(err.message).to.equal('err1')
    expect(err.note).to.equal('some note')
  })

  it('should default note to null', () => {
    const err = new SwarmValidationError(['err1'])
    expect(err.note).to.be.null
  })
})
