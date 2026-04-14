import {expect} from 'chai'

import SwarmCurate from '../../../src/oclif/commands/swarm/curate.js'

describe('SwarmCurate command', () => {
  it('has correct description', () => {
    expect(SwarmCurate.description.toLowerCase()).to.include('store')
    expect(SwarmCurate.description.toLowerCase()).to.include('swarm')
  })

  it('accepts a content argument', () => {
    expect(SwarmCurate.args).to.have.property('content')
  })

  it('supports provider and format flags', () => {
    expect(SwarmCurate.flags.provider).to.exist
    expect(SwarmCurate.flags.format).to.exist
  })

  it('can be instantiated', () => {
    expect(SwarmCurate).to.have.property('description')
    expect(SwarmCurate.prototype).to.have.property('run')
  })
})
