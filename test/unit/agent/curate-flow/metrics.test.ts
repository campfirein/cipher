import {expect} from 'chai'

import type {NodeSlot} from '../../../../src/agent/core/curation/flow/types.js'

import {MetricsCollector} from '../../../../src/agent/core/curation/flow/metrics.js'

describe('MetricsCollector', () => {
  describe('per-node timing', () => {
    it('records a duration > 0 for a started+ended node', async () => {
      const collector = new MetricsCollector('task-123')

      collector.startNode('recon')
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      collector.endNode('recon')

      const event = collector.emit()
      expect(event.nodeTimings.recon).to.be.greaterThan(0)
    })

    it('records 0 ms (not undefined) when endNode is called immediately after startNode', () => {
      const collector = new MetricsCollector('task-123')

      collector.startNode('chunk')
      collector.endNode('chunk')

      const event = collector.emit()
      expect(event.nodeTimings.chunk).to.be.a('number')
      expect(event.nodeTimings.chunk).to.be.gte(0)
    })

    it('tracks multiple nodes independently', async () => {
      const collector = new MetricsCollector('task-123')

      collector.startNode('recon')
      await new Promise((resolve) => {
        setTimeout(resolve, 3)
      })
      collector.endNode('recon')

      collector.startNode('extract')
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      collector.endNode('extract')

      const event = collector.emit()
      expect(event.nodeTimings.recon).to.be.greaterThan(0)
      expect(event.nodeTimings.extract).to.be.greaterThan(0)
    })
  })

  describe('emit() shape', () => {
    it('returns an event matching the documented shape', () => {
      const collector = new MetricsCollector('task-abc')
      collector.startNode('recon')
      collector.endNode('recon')
      collector.recordFallback('extract-chunk-2')

      const event = collector.emit()

      expect(event.type).to.equal('curate-flow:run')
      expect(event.taskId).to.equal('task-abc')
      expect(event.nodeTimings).to.be.an('object')
      expect(event.totalWallClockMs).to.be.a('number')
      expect(event.fallbacksTriggered).to.deep.equal(['extract-chunk-2'])
    })

    it('zero-fills all slots in nodeTimings (per Phase 1 contract)', () => {
      const collector = new MetricsCollector('task-xyz')
      collector.startNode('recon')
      collector.endNode('recon')

      const event = collector.emit()

      // Recon ran → > 0
      expect(event.nodeTimings.recon).to.be.gte(0)
      // All other slots present and zero-filled
      expect(event.nodeTimings.chunk).to.equal(0)
      expect(event.nodeTimings.extract).to.equal(0)
      expect(event.nodeTimings.group).to.equal(0)
      expect(event.nodeTimings.dedup).to.equal(0)
      expect(event.nodeTimings.conflict).to.equal(0)
      expect(event.nodeTimings.write).to.equal(0)
    })
  })

  describe('zero-state', () => {
    it('returns nodeTimings with all 7 slots zero-filled when no nodes ran', () => {
      const collector = new MetricsCollector('task-empty')
      const event = collector.emit()

      expect(event.type).to.equal('curate-flow:run')
      expect(event.taskId).to.equal('task-empty')
      expect(Object.keys(event.nodeTimings)).to.have.length(7)
      for (const slot of [
        'recon', 'chunk', 'extract', 'group', 'dedup', 'conflict', 'write',
      ] as const) {
        expect(event.nodeTimings[slot], `${slot} should be zero-filled`).to.equal(0)
      }

      expect(event.fallbacksTriggered).to.deep.equal([])
      expect(event.totalWallClockMs).to.be.gte(0)
    })
  })

  describe('totalWallClockMs', () => {
    it('reflects time from first startNode to last endNode', async () => {
      const collector = new MetricsCollector('task-wall')
      collector.startNode('recon')
      collector.endNode('recon')

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      collector.startNode('write')
      collector.endNode('write')

      const event = collector.emit()
      expect(event.totalWallClockMs).to.be.greaterThan(8)
    })
  })

  describe('error cases', () => {
    it('throws if endNode called without matching startNode', () => {
      const collector = new MetricsCollector('task-err')
      expect(() => collector.endNode('recon' as NodeSlot)).to.throw(/recon/)
    })
  })
})
