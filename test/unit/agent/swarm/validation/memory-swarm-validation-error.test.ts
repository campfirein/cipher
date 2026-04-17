import {expect} from 'chai'

import {
  MemorySwarmValidationError,
  type ValidationIssue,
} from '../../../../../src/agent/infra/swarm/validation/memory-swarm-validation-error.js'

describe('MemorySwarmValidationError', () => {
  it('constructs with errors and warnings', () => {
    const errors: ValidationIssue[] = [
      {message: 'API key invalid', provider: 'honcho', suggestion: 'Check HONCHO_API_KEY'},
    ]
    const warnings: ValidationIssue[] = [
      {message: 'Path not found', provider: 'local-markdown'},
    ]
    const error = new MemorySwarmValidationError(errors, warnings)

    expect(error).to.be.instanceOf(Error)
    expect(error.errors).to.deep.equal(errors)
    expect(error.warnings).to.deep.equal(warnings)
    expect(error.message).to.include('1 error(s)')
  })

  it('includes cascade note in message when provided', () => {
    const error = new MemorySwarmValidationError(
      [{message: 'Connection timeout', provider: 'hindsight'}],
      [],
      '2 cloud providers failed. Routing will use local providers only.'
    )
    expect(error.cascadeNote).to.include('cloud providers')
  })

  it('handles empty errors and warnings', () => {
    const error = new MemorySwarmValidationError([], [])
    expect(error.errors).to.have.length(0)
    expect(error.warnings).to.have.length(0)
    expect(error.message).to.include('0 error(s)')
  })

  it('serializes to JSON', () => {
    const error = new MemorySwarmValidationError(
      [{field: 'api_key', message: 'Bad key', provider: 'honcho', suggestion: 'Fix it'}],
      [{message: 'Path missing', provider: 'obsidian'}],
      'Cascade note'
    )
    const json = error.toJSON()
    expect(json.errors).to.have.length(1)
    expect(json.warnings).to.have.length(1)
    expect(json.cascadeNote).to.equal('Cascade note')
  })

  it('has correct name property', () => {
    const error = new MemorySwarmValidationError([], [])
    expect(error.name).to.equal('MemorySwarmValidationError')
  })
})
