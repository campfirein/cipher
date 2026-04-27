import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {IBillingService} from '../../../../../src/server/core/interfaces/services/i-billing-service.js'
import type {IBillingConfigStore} from '../../../../../src/server/core/interfaces/storage/i-billing-config-store.js'
import type {BillingFreeUserLimitDTO, BillingUsageDTO} from '../../../../../src/shared/transport/types/dto.js'

import {BillingHandler} from '../../../../../src/server/infra/transport/handlers/billing-handler.js'
import {BillingEvents} from '../../../../../src/shared/transport/events/billing-events.js'
import {createMockAuthStateStore, createMockTransportServer} from '../../../../helpers/mock-factories.js'

const usageFixture = (overrides: Partial<BillingUsageDTO> = {}): BillingUsageDTO => ({
  addOnRemaining: 0,
  isTrialing: false,
  limit: 100_000,
  limitExceeded: false,
  organizationId: 'org-123',
  organizationName: 'Acme Corp',
  organizationStatus: 'ACTIVE',
  percentUsed: 12.4,
  remaining: 87_600,
  tier: 'PRO',
  totalLimit: 100_000,
  used: 12_400,
  ...overrides,
})

const freeUserLimitFixture: BillingFreeUserLimitDTO = {
  daily: {limit: 50, limitExceeded: false, percentUsed: 20, remaining: 40, used: 10},
  limitExceeded: false,
  monthly: {limit: 1000, limitExceeded: false, percentUsed: 5, remaining: 950, used: 50},
}

describe('BillingHandler', () => {
  let sandbox: SinonSandbox
  let transport: ReturnType<typeof createMockTransportServer>
  let billingService: IBillingService
  let billingConfigStore: IBillingConfigStore
  let getUsagesStub: ReturnType<SinonSandbox['stub']>
  let getFreeUserLimitStub: ReturnType<SinonSandbox['stub']>
  let getPinnedStub: ReturnType<SinonSandbox['stub']>
  let setPinnedStub: ReturnType<SinonSandbox['stub']>

  beforeEach(() => {
    sandbox = createSandbox()
    transport = createMockTransportServer()
    getUsagesStub = sandbox.stub()
    getFreeUserLimitStub = sandbox.stub()
    getPinnedStub = sandbox.stub().resolves()
    setPinnedStub = sandbox.stub().resolves()
    billingService = {
      getFreeUserLimit: getFreeUserLimitStub as IBillingService['getFreeUserLimit'],
      getTiers: sandbox.stub().resolves([]) as unknown as IBillingService['getTiers'],
      getUsages: getUsagesStub as IBillingService['getUsages'],
    }
    billingConfigStore = {
      getPinnedOrganizationId: getPinnedStub as IBillingConfigStore['getPinnedOrganizationId'],
      setPinnedOrganizationId: setPinnedStub as IBillingConfigStore['setPinnedOrganizationId'],
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  function createHandler(options?: {isAuthenticated?: boolean}): BillingHandler {
    const handler = new BillingHandler({
      authStateStore: createMockAuthStateStore(sandbox, options),
      billingConfigStore,
      billingService,
      transport,
    })
    handler.setup()
    return handler
  }

  describe('billing:getUsage', () => {
    it('registers the handler on setup', () => {
      createHandler()
      expect(transport._handlers.has(BillingEvents.GET_USAGE)).to.equal(true)
    })

    it('returns the matching org from the bulk fetch when authenticated', async () => {
      const orgA = usageFixture({organizationId: 'org-a'})
      const orgB = usageFixture({organizationId: 'org-b'})
      getUsagesStub.resolves([orgA, orgB])
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_USAGE)
      const result = await handler!({organizationId: 'org-b'}, 'client-1')

      expect(getUsagesStub.calledOnceWith('session')).to.equal(true)
      expect(result).to.deep.equal({usage: orgB})
    })

    it('returns an error envelope when the requested org is not in the response', async () => {
      getUsagesStub.resolves([usageFixture({organizationId: 'org-a'})])
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_USAGE)
      const result = await handler!({organizationId: 'org-missing'}, 'client-1')

      expect(result).to.have.property('error').that.matches(/org-missing/)
      expect(result).to.not.have.property('usage')
    })

    it('returns an error response when the user is not authenticated', async () => {
      createHandler({isAuthenticated: false})

      const handler = transport._handlers.get(BillingEvents.GET_USAGE)
      const result = await handler!({organizationId: 'org-123'}, 'client-1')

      expect(getUsagesStub.called).to.equal(false)
      expect(result).to.have.property('error').that.matches(/sign in|authent/i)
      expect(result).to.not.have.property('usage')
    })

    it('returns an error response when the billing service throws', async () => {
      getUsagesStub.rejects(new Error('boom'))
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_USAGE)
      const result = await handler!({organizationId: 'org-123'}, 'client-1')

      expect(result).to.have.property('error').that.equals('boom')
      expect(result).to.not.have.property('usage')
    })
  })

  describe('billing:listUsage', () => {
    it('registers the handler on setup', () => {
      createHandler()
      expect(transport._handlers.has(BillingEvents.LIST_USAGE)).to.equal(true)
    })

    it('returns a usage map keyed by organization id when authenticated', async () => {
      const orgA = usageFixture({organizationId: 'org-a'})
      const orgB = usageFixture({organizationId: 'org-b'})
      getUsagesStub.resolves([orgA, orgB])
      createHandler()

      const handler = transport._handlers.get(BillingEvents.LIST_USAGE)
      const result = await handler!(undefined, 'client-1')

      expect(getUsagesStub.calledOnceWith('session')).to.equal(true)
      expect(result).to.deep.equal({usage: {'org-a': orgA, 'org-b': orgB}})
    })

    it('returns an empty map when the user has no organizations', async () => {
      getUsagesStub.resolves([])
      createHandler()

      const handler = transport._handlers.get(BillingEvents.LIST_USAGE)
      const result = await handler!(undefined, 'client-1')

      expect(result).to.deep.equal({usage: {}})
    })

    it('returns an error envelope when the user is not authenticated', async () => {
      createHandler({isAuthenticated: false})

      const handler = transport._handlers.get(BillingEvents.LIST_USAGE)
      const result = await handler!(undefined, 'client-1')

      expect(getUsagesStub.called).to.equal(false)
      expect(result).to.have.property('error').that.matches(/sign in|authent/i)
      expect(result).to.not.have.property('usage')
    })

    it('returns an error envelope when the billing service throws', async () => {
      getUsagesStub.rejects(new Error('upstream down'))
      createHandler()

      const handler = transport._handlers.get(BillingEvents.LIST_USAGE)
      const result = await handler!(undefined, 'client-1')

      expect(result).to.deep.equal({error: 'upstream down'})
    })
  })

  describe('billing:getFreeUserLimit', () => {
    it('registers the handler on setup', () => {
      createHandler()
      expect(transport._handlers.has(BillingEvents.GET_FREE_USER_LIMIT)).to.equal(true)
    })

    it('returns the free-user limit when authenticated', async () => {
      getFreeUserLimitStub.resolves(freeUserLimitFixture)
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_FREE_USER_LIMIT)
      const result = await handler!(undefined, 'client-1')

      expect(getFreeUserLimitStub.calledOnceWith('session')).to.equal(true)
      expect(result).to.deep.equal({limit: freeUserLimitFixture})
    })

    it('returns an error envelope when not authenticated', async () => {
      createHandler({isAuthenticated: false})

      const handler = transport._handlers.get(BillingEvents.GET_FREE_USER_LIMIT)
      const result = await handler!(undefined, 'client-1')

      expect(getFreeUserLimitStub.called).to.equal(false)
      expect(result).to.have.property('error').that.matches(/sign in|authent/i)
    })

    it('returns an error envelope when the service throws', async () => {
      getFreeUserLimitStub.rejects(new Error('quota service offline'))
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_FREE_USER_LIMIT)
      const result = await handler!(undefined, 'client-1')

      expect(result).to.deep.equal({error: 'quota service offline'})
    })
  })

  describe('billing:getPinnedOrganization', () => {
    it('registers the handler on setup', () => {
      createHandler()
      expect(transport._handlers.has(BillingEvents.GET_PINNED_ORGANIZATION)).to.equal(true)
    })

    it('returns the persisted organization id', async () => {
      getPinnedStub.resolves('org-pinned')
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_PINNED_ORGANIZATION)
      const result = await handler!(undefined, 'client-1')

      expect(result).to.deep.equal({organizationId: 'org-pinned'})
    })

    it('returns an empty envelope when no pin is set', async () => {
      getPinnedStub.resolves()
      createHandler()

      const handler = transport._handlers.get(BillingEvents.GET_PINNED_ORGANIZATION)
      const result = await handler!(undefined, 'client-1')

      expect(result).to.deep.equal({})
    })
  })

  describe('billing:setPinnedOrganization', () => {
    it('registers the handler on setup', () => {
      createHandler()
      expect(transport._handlers.has(BillingEvents.SET_PINNED_ORGANIZATION)).to.equal(true)
    })

    it('writes the new pin and returns success', async () => {
      createHandler()

      const handler = transport._handlers.get(BillingEvents.SET_PINNED_ORGANIZATION)
      const result = await handler!({organizationId: 'org-new'}, 'client-1')

      expect(setPinnedStub.calledOnceWith('org-new')).to.equal(true)
      expect(result).to.deep.equal({success: true})
    })

    it('clears the pin when organizationId is omitted', async () => {
      createHandler()

      const handler = transport._handlers.get(BillingEvents.SET_PINNED_ORGANIZATION)
      const result = await handler!({}, 'client-1')

      expect(setPinnedStub.calledOnceWith()).to.equal(true)
      expect(result).to.deep.equal({success: true})
    })

    it('returns an error envelope when the store throws', async () => {
      setPinnedStub.rejects(new Error('disk full'))
      createHandler()

      const handler = transport._handlers.get(BillingEvents.SET_PINNED_ORGANIZATION)
      const result = await handler!({organizationId: 'org-new'}, 'client-1')

      expect(result).to.deep.equal({error: 'disk full', success: false})
    })
  })
})
