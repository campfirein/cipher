import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IGlobalConfigStore} from '../../../../../src/server/core/interfaces/storage/i-global-config-store.js'

import {GLOBAL_CONFIG_VERSION} from '../../../../../src/server/constants.js'
import {GlobalConfig} from '../../../../../src/server/core/domain/entities/global-config.js'
import {GlobalConfigHandler} from '../../../../../src/server/infra/transport/handlers/global-config-handler.js'
import {GlobalConfigEvents} from '../../../../../src/shared/transport/events/global-config-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

function createMockGlobalConfigStore(): SinonStubbedInstance<IGlobalConfigStore> {
  return {
    read: stub<[], Promise<GlobalConfig | undefined>>().resolves(),
    write: stub<[GlobalConfig], Promise<void>>().resolves(),
  }
}

describe('GlobalConfigHandler', () => {
  let store: SinonStubbedInstance<IGlobalConfigStore>
  let transport: MockTransportServer
  let handler: GlobalConfigHandler

  beforeEach(() => {
    store = createMockGlobalConfigStore()
    transport = createMockTransportServer()
    handler = new GlobalConfigHandler({globalConfigStore: store, transport})
    handler.setup()
  })

  afterEach(() => {
    restore()
  })

  async function callGet(): Promise<{analytics: boolean; deviceId: string; version: string}> {
    const fn = transport._handlers.get(GlobalConfigEvents.GET)
    if (!fn) throw new Error(`handler not registered: ${GlobalConfigEvents.GET}`)
    return fn(undefined, 'client-1')
  }

  async function callSet(analytics: boolean): Promise<{current: boolean; previous: boolean}> {
    const fn = transport._handlers.get(GlobalConfigEvents.SET_ANALYTICS)
    if (!fn) throw new Error(`handler not registered: ${GlobalConfigEvents.SET_ANALYTICS}`)
    return fn({analytics}, 'client-1')
  }

  describe('setup', () => {
    it('registers GET and SET_ANALYTICS handlers', () => {
      expect(transport._handlers.has(GlobalConfigEvents.GET)).to.be.true
      expect(transport._handlers.has(GlobalConfigEvents.SET_ANALYTICS)).to.be.true
    })
  })

  describe('getCachedAnalytics', () => {
    it('throws before refreshCache() resolves', () => {
      expect(() => handler.getCachedAnalytics()).to.throw(/refreshCache/)
    })

    it('returns the cached flag after refreshCache() populates from disk', async () => {
      const config = GlobalConfig.create('device-abc').withAnalytics(true)
      store.read.resolves(config)

      await handler.refreshCache()

      expect(handler.getCachedAnalytics()).to.be.true
    })
  })

  describe('refreshCache', () => {
    it('sets cache to false when no config exists on disk', async () => {
      store.read.resolves()

      await handler.refreshCache()

      expect(handler.getCachedAnalytics()).to.be.false
    })

    it('swallows store.read errors and sets cache to false (fail-safe)', async () => {
      store.read.rejects(new Error('disk failure'))

      await handler.refreshCache()

      expect(handler.getCachedAnalytics()).to.be.false
    })
  })

  describe('GET handler', () => {
    it('returns disk values when config exists', async () => {
      const config = GlobalConfig.create('device-xyz').withAnalytics(true)
      store.read.resolves(config)

      const result = await callGet()

      expect(result).to.deep.equal({
        analytics: true,
        deviceId: 'device-xyz',
        version: config.version,
      })
      expect(store.write.called, 'must not write on read').to.be.false
    })

    it('returns synthetic defaults and does NOT write when no config exists (D1 invariant)', async () => {
      store.read.resolves()

      const result = await callGet()

      expect(result).to.deep.equal({
        analytics: false,
        deviceId: '',
        version: GLOBAL_CONFIG_VERSION,
      })
      expect(store.write.called, 'read() must be pure — no write on missing config').to.be.false
    })

    it('updates the cached flag when config exists', async () => {
      const config = GlobalConfig.create('device-1').withAnalytics(true)
      store.read.resolves(config)

      await callGet()

      expect(handler.getCachedAnalytics()).to.be.true
    })
  })

  describe('SET_ANALYTICS handler', () => {
    it('idempotent fast-path: no write when requested value matches current', async () => {
      const config = GlobalConfig.create('device-1').withAnalytics(true)
      store.read.resolves(config)

      const result = await callSet(true)

      expect(result).to.deep.equal({current: true, previous: true})
      expect(store.write.called, 'must not write on idempotent SET').to.be.false
    })

    it('idempotent fast-path: no write when toggling from default (no config) to false', async () => {
      store.read.resolves()

      const result = await callSet(false)

      expect(result).to.deep.equal({current: false, previous: false})
      expect(store.write.called, 'must not seed a config just to match the default').to.be.false
    })

    it('round-trip: writes updated config and returns previous/current', async () => {
      const config = GlobalConfig.create('device-1').withAnalytics(false)
      store.read.resolves(config)

      const result = await callSet(true)

      expect(result).to.deep.equal({current: true, previous: false})
      expect(store.write.calledOnce).to.be.true
      const written = store.write.firstCall.args[0]
      expect(written.deviceId).to.equal('device-1')
      expect(written.analytics).to.be.true
    })

    it('seeds a new deviceId when enabling for the first time (no config on disk)', async () => {
      store.read.resolves()

      const result = await callSet(true)

      expect(result.current).to.be.true
      expect(result.previous).to.be.false
      expect(store.write.calledOnce).to.be.true
      const written = store.write.firstCall.args[0]
      expect(written.deviceId.length).to.be.greaterThan(0)
      expect(written.analytics).to.be.true
    })

    it('updates the cached flag after a successful write', async () => {
      const config = GlobalConfig.create('device-1').withAnalytics(false)
      store.read.resolves(config)

      await callSet(true)

      expect(handler.getCachedAnalytics()).to.be.true
    })
  })
})
