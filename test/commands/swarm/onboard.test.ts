import {expect} from 'chai'

import SwarmOnboard from '../../../src/oclif/commands/swarm/onboard.js'

describe('SwarmOnboard command', () => {
  it('has correct description', () => {
    expect(SwarmOnboard.description).to.include('memory swarm')
    expect(SwarmOnboard.description).to.include('onboarding')
  })

  it('can be instantiated', () => {
    // Verify the class is importable and has the expected shape
    expect(SwarmOnboard).to.have.property('description')
    expect(SwarmOnboard.prototype).to.have.property('run')
  })
})
