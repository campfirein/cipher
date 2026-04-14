import {expect} from 'chai'

import SwarmQuery from '../../../src/oclif/commands/swarm/query.js'

describe('SwarmQuery command', () => {
  it('has correct description', () => {
    expect(SwarmQuery.description).to.include('swarm')
    expect(SwarmQuery.description.toLowerCase()).to.include('query')
  })

  it('accepts a query argument', () => {
    expect(SwarmQuery.args).to.have.property('query')
  })

  it('supports text and json format flags', () => {
    expect(SwarmQuery.flags.format).to.exist
  })

  it('can be instantiated', () => {
    expect(SwarmQuery).to.have.property('description')
    expect(SwarmQuery.prototype).to.have.property('run')
  })
})
