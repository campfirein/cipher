import {expect} from 'chai'

import {policyPermitsDelegation} from '../../../../../../src/server/infra/channel/bridge/delegate-policy.js'

// Phase 9 / Slice 9.9 — pure policy gate for the `delegate_policy`
// config. Query envelopes always pass; delegate envelopes consult
// the policy.

describe('policyPermitsDelegation (slice 9.9)', () => {
  describe('query envelopes', () => {
    it('accepted under `auto` without prompting', () => {
      const r = policyPermitsDelegation('auto', 'query')
      expect(r.accepted).to.equal(true)
      if (r.accepted) expect(r.requiresInteractiveApproval).to.equal(false)
    })

    it('accepted under `prompt` without prompting (read-only is always free)', () => {
      const r = policyPermitsDelegation('prompt', 'query')
      expect(r.accepted).to.equal(true)
      if (r.accepted) expect(r.requiresInteractiveApproval).to.equal(false)
    })

    it('accepted under `deny` (deny only blocks delegate envelopes)', () => {
      const r = policyPermitsDelegation('deny', 'query')
      expect(r.accepted).to.equal(true)
    })
  })

  describe('delegate envelopes', () => {
    it('accepted under `auto` without prompting', () => {
      const r = policyPermitsDelegation('auto', 'delegate')
      expect(r.accepted).to.equal(true)
      if (r.accepted) expect(r.requiresInteractiveApproval).to.equal(false)
    })

    it('accepted under `prompt` BUT requiresInteractiveApproval=true', () => {
      const r = policyPermitsDelegation('prompt', 'delegate')
      expect(r.accepted).to.equal(true)
      if (r.accepted) expect(r.requiresInteractiveApproval).to.equal(true)
    })

    it('rejected under `deny` with DELEGATE_POLICY_DENY reason', () => {
      const r = policyPermitsDelegation('deny', 'delegate')
      expect(r.accepted).to.equal(false)
      if (!r.accepted) expect(r.reason).to.equal('DELEGATE_POLICY_DENY')
    })
  })
})
