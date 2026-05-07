import {expect} from 'chai'

import {resolveBillingTeamId} from '../../../../src/server/infra/billing/resolve-billing-team.js'

describe('resolveBillingTeamId', () => {
  describe('step 1 — explicit pin wins', () => {
    it('returns the pinned organization id when set', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A', 'org-B'],
          pinnedTeamId: 'org-pin',
          workspaceTeamId: 'org-A',
        }),
      ).to.equal('org-pin')
    })

    it('returns the pin even when the workspace also matches a paid org', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A'],
          pinnedTeamId: 'org-pin',
          workspaceTeamId: 'org-A',
        }),
      ).to.equal('org-pin')
    })

    it('returns the pin even when it is not in the user\'s paid orgs (BE rejects later)', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A'],
          pinnedTeamId: 'org-stale',
          workspaceTeamId: undefined,
        }),
      ).to.equal('org-stale')
    })
  })

  describe('step 2 — workspace match', () => {
    it('returns the workspace team when it appears in paid orgs', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A', 'org-B'],
          pinnedTeamId: undefined,
          workspaceTeamId: 'org-A',
        }),
      ).to.equal('org-A')
    })

    it('does NOT return the workspace team when it is not a paid org', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A'],
          pinnedTeamId: undefined,
          workspaceTeamId: 'org-Z',
        }),
      ).to.not.equal('org-Z')
    })

    it('treats an empty-string workspace team as missing (regression guard)', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A'],
          pinnedTeamId: undefined,
          workspaceTeamId: undefined,
        }),
      ).to.equal('org-A')
    })
  })

  describe('step 3 — single paid team auto-pick', () => {
    it('returns the single paid org when no pin and no workspace match', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-only'],
          pinnedTeamId: undefined,
          workspaceTeamId: 'org-not-a-paid-team',
        }),
      ).to.equal('org-only')
    })

    it('returns the single paid org when there is no workspace at all', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-only'],
          pinnedTeamId: undefined,
          workspaceTeamId: undefined,
        }),
      ).to.equal('org-only')
    })
  })

  describe('step 4 — free pool fallback', () => {
    it('returns undefined when there are multiple paid orgs and no pin/workspace match', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: ['org-A', 'org-B'],
          pinnedTeamId: undefined,
          workspaceTeamId: 'org-not-a-paid-team',
        }),
      ).to.equal(undefined)
    })

    it('returns undefined when the user has no paid orgs', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: [],
          pinnedTeamId: undefined,
          workspaceTeamId: 'org-anything',
        }),
      ).to.equal(undefined)
    })

    it('returns undefined when nothing is set at all', () => {
      expect(
        resolveBillingTeamId({
          paidOrganizationIds: [],
          pinnedTeamId: undefined,
          workspaceTeamId: undefined,
        }),
      ).to.equal(undefined)
    })
  })
})
