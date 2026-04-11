import {expect} from 'chai'

import SwarmStatus from '../../../src/oclif/commands/swarm/status.js'

describe('SwarmStatus command', () => {
  it('has correct description', () => {
    expect(SwarmStatus.description).to.include('memory swarm')
    expect(SwarmStatus.description).to.include('health')
  })

  it('supports text and json format flags', () => {
    expect(SwarmStatus.flags.format).to.exist
  })

  it('can be instantiated', () => {
    expect(SwarmStatus).to.have.property('description')
    expect(SwarmStatus.prototype).to.have.property('run')
  })
})
