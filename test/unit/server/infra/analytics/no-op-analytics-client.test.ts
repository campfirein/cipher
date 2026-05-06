import {expect} from 'chai'

import {NoOpAnalyticsClient} from '../../../../../src/server/infra/analytics/no-op-analytics-client.js'

describe('NoOpAnalyticsClient', () => {
  describe('track()', () => {
    it('should return void without throwing for varied inputs', () => {
      const client = new NoOpAnalyticsClient()

      expect(() => client.track('event_no_props')).to.not.throw()
      expect(() => client.track('event_with_props', {key: 'value'})).to.not.throw()
      expect(() => client.track('event_undefined_props')).to.not.throw()
      expect(() => client.track('')).to.not.throw()
      for (let i = 0; i < 1000; i++) {
        expect(() => client.track(`event_${i}`, {iteration: i})).to.not.throw()
      }
    })
  })

  describe('flush()', () => {
    it('should resolve to an empty batch with schema_version: 1', async () => {
      const client = new NoOpAnalyticsClient()

      const batch = await client.flush()

      expect(batch.schema_version).to.equal(1)
      expect(batch.events).to.deep.equal([])
    })

    it('should still return an empty batch after many track() calls (track is truly a no-op)', async () => {
      const client = new NoOpAnalyticsClient()

      for (let i = 0; i < 100; i++) {
        client.track(`event_${i}`, {x: i})
      }

      const batch = await client.flush()

      expect(batch.events).to.deep.equal([])
    })
  })
})
