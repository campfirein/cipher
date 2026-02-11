import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ITrackingService} from '../../../../../src/server/core/interfaces/services/i-tracking-service.js'
import type {IOnboardingPreferenceStore} from '../../../../../src/server/core/interfaces/storage/i-onboarding-preference-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {OnboardingHandler} from '../../../../../src/server/infra/transport/handlers/onboarding-handler.js'
import {OnboardingEvents} from '../../../../../src/shared/transport/events/onboarding-events.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub(),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

// ==================== Tests ====================

describe('OnboardingHandler', () => {
  let onboardingPreferenceStore: SinonStubbedInstance<IOnboardingPreferenceStore>
  let trackingService: SinonStubbedInstance<ITrackingService>
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    onboardingPreferenceStore = {
      clear: stub(),
      getLastDismissedAt: stub(),
      setLastDismissedAt: stub(),
    }

    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }

    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): OnboardingHandler {
    const handler = new OnboardingHandler({
      onboardingPreferenceStore,
      trackingService,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callGetStateHandler(): Promise<{hasOnboarded: boolean}> {
    const handler = transport._handlers.get(OnboardingEvents.GET_STATE)
    expect(handler, 'onboarding:getState handler should be registered').to.exist
    return handler!(undefined, 'client-1')
  }

  async function callCompleteHandler(data?: {skipped?: boolean}): Promise<{success: boolean}> {
    const handler = transport._handlers.get(OnboardingEvents.COMPLETE)
    expect(handler, 'onboarding:complete handler should be registered').to.exist
    return handler!(data, 'client-1')
  }

  describe('setup', () => {
    it('should register getState and complete handlers', () => {
      createHandler()
      expect(transport.onRequest.calledTwice).to.be.true
      expect(transport._handlers.has(OnboardingEvents.GET_STATE)).to.be.true
      expect(transport._handlers.has(OnboardingEvents.COMPLETE)).to.be.true
    })
  })

  describe('getState', () => {
    it('should return hasOnboarded=true when dismiss file exists', async () => {
      createHandler()
      onboardingPreferenceStore.getLastDismissedAt.resolves(Date.now())

      const result = await callGetStateHandler()

      expect(result.hasOnboarded).to.be.true
    })

    it('should return hasOnboarded=false when dismiss file does not exist', async () => {
      createHandler()
      onboardingPreferenceStore.getLastDismissedAt.resolves()

      const result = await callGetStateHandler()

      expect(result.hasOnboarded).to.be.false
    })

    it('should return hasOnboarded=false when preference store throws', async () => {
      createHandler()
      onboardingPreferenceStore.getLastDismissedAt.rejects(new Error('File read error'))

      const result = await callGetStateHandler()

      expect(result.hasOnboarded).to.be.false
    })
  })

  describe('complete', () => {
    it('should write dismiss file and return success', async () => {
      createHandler()
      onboardingPreferenceStore.setLastDismissedAt.resolves()

      const result = await callCompleteHandler()

      expect(result.success).to.be.true
      expect(onboardingPreferenceStore.setLastDismissedAt.calledOnce).to.be.true
    })

    it('should track onboarding:completed event', async () => {
      createHandler()
      onboardingPreferenceStore.setLastDismissedAt.resolves()

      await callCompleteHandler()

      expect(trackingService.track.calledWith('onboarding:completed')).to.be.true
    })

    it('should track onboarding:skipped when skipped is true', async () => {
      createHandler()
      onboardingPreferenceStore.setLastDismissedAt.resolves()

      await callCompleteHandler({skipped: true})

      expect(trackingService.track.calledWith('onboarding:skipped')).to.be.true
    })

    it('should return success=false when preference store throws', async () => {
      createHandler()
      onboardingPreferenceStore.setLastDismissedAt.rejects(new Error('Write error'))

      const result = await callCompleteHandler()

      expect(result.success).to.be.false
    })
  })
})
