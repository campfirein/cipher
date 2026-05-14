import {expect} from 'chai'

import type {BillingUsageDTO} from '../../../../../../src/shared/transport/types/dto'

import {resolveBilledTeam} from '../../../../../../src/webui/features/provider/utils/resolve-billed-team'

function makeUsage(id: string, tier: 'FREE' | 'PRO' | 'TEAM' = 'TEAM'): BillingUsageDTO {
  return {
    addOnRemaining: 0,
    isTrialing: false,
    limit: 100_000,
    limitExceeded: false,
    organizationId: id,
    organizationName: id,
    organizationStatus: 'ACTIVE',
    percentUsed: 0,
    remaining: 100_000,
    tier,
    totalLimit: 100_000,
    used: 0,
  }
}

describe('resolveBilledTeam', () => {
  it('returns undefined when there are no paid teams', () => {
    const result = resolveBilledTeam({
      paidOrganizationIds: [],
      preferredOrgId: 'any-id',
      usagesByOrg: {'any-id': makeUsage('any-id', 'FREE')},
    })
    expect(result).to.equal(undefined)
  })

  it('auto-picks the single paid team when no pin is provided', () => {
    const usage = makeUsage('A')
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A'],
      usagesByOrg: {A: usage},
    })
    expect(result).to.equal(usage)
  })

  it('honors a valid pin to a paid team', () => {
    const a = makeUsage('A')
    const b = makeUsage('B')
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A', 'B'],
      preferredOrgId: 'B',
      usagesByOrg: {A: a, B: b},
    })
    expect(result).to.equal(b)
  })

  it('honors a pin to a free-tier team when paid teams exist (visual pin)', () => {
    const a = makeUsage('A')
    const free = makeUsage('free', 'FREE')
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A'],
      preferredOrgId: 'free',
      usagesByOrg: {A: a, free},
    })
    expect(result).to.equal(free)
  })

  it('falls through to auto-pick when pin is stale and there is exactly one paid team', () => {
    const a = makeUsage('A')
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A'],
      preferredOrgId: 'stale-id',
      usagesByOrg: {A: a},
    })
    expect(result).to.equal(a)
  })

  it('returns undefined when there are 2+ paid teams and no valid pin', () => {
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A', 'B'],
      usagesByOrg: {A: makeUsage('A'), B: makeUsage('B')},
    })
    expect(result).to.equal(undefined)
  })

  it('returns undefined when pin is stale and there are 2+ paid teams (no auto-pick)', () => {
    const result = resolveBilledTeam({
      paidOrganizationIds: ['A', 'B'],
      preferredOrgId: 'stale-id',
      usagesByOrg: {A: makeUsage('A'), B: makeUsage('B')},
    })
    expect(result).to.equal(undefined)
  })
})
