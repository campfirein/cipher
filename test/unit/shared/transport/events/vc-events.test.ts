import {expect} from 'chai'

import {isVcConfigKey, VC_CONFIG_KEYS} from '../../../../../src/shared/transport/events/vc-events.js'

describe('VcConfigKey', () => {
  it('canonical keys are all lowercase (no dual camel-case entries)', () => {
    // M4: camel-case variants used to be part of the exported set and caused
    // duplicate entries in VC_CONFIG_KEYS. Canonical is lowercase only.
    expect(VC_CONFIG_KEYS).to.deep.equal([
      'user.name',
      'user.email',
      'user.signingkey',
      'commit.sign',
    ])
  })

  describe('isVcConfigKey() — lenient case-insensitive parse', () => {
    it('accepts the canonical lowercase form', () => {
      expect(isVcConfigKey('user.signingkey')).to.be.true
    })

    it('accepts a camel-case variant (backward compat for git-style spelling)', () => {
      expect(isVcConfigKey('user.signingKey')).to.be.true
    })

    it('accepts an all-uppercase variant', () => {
      expect(isVcConfigKey('USER.SIGNINGKEY')).to.be.true
    })

    it('rejects an unrelated key', () => {
      expect(isVcConfigKey('user.notARealKey')).to.be.false
    })

    it('rejects the empty string', () => {
      expect(isVcConfigKey('')).to.be.false
    })
  })
})
