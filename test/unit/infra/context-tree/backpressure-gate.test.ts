import {expect} from 'chai'

import {BackpressureGate} from '../../../../src/server/infra/context-tree/backpressure-gate.js'

describe('BackpressureGate', () => {
  describe('evaluate()', () => {
    it('should return accept when projected count is below threshold', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30})

      const decision = gate.evaluate({
        lastConsolidatedAt: new Date(Date.now() - 600_000).toISOString(),
        projectedEntryCount: 20,
      })

      expect(decision).to.equal('accept')
    })

    it('should return trigger-consolidation when projected count exceeds threshold and interval elapsed', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30, minConsolidationIntervalSec: 300})

      const decision = gate.evaluate({
        lastConsolidatedAt: new Date(Date.now() - 600_000).toISOString(), // 10 min ago
        projectedEntryCount: 35,
      })

      expect(decision).to.equal('trigger-consolidation')
    })

    it('should return accept when threshold exceeded but interval not elapsed', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30, minConsolidationIntervalSec: 300})

      const decision = gate.evaluate({
        lastConsolidatedAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
        projectedEntryCount: 35,
      })

      expect(decision).to.equal('accept')
    })

    it('should treat empty lastConsolidatedAt as never-consolidated (always eligible)', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30, minConsolidationIntervalSec: 300})

      const decision = gate.evaluate({
        lastConsolidatedAt: '',
        projectedEntryCount: 35,
      })

      expect(decision).to.equal('trigger-consolidation')
    })

    it('should treat invalid date string as never-consolidated', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30, minConsolidationIntervalSec: 300})

      const decision = gate.evaluate({
        lastConsolidatedAt: 'not-a-date',
        projectedEntryCount: 35,
      })

      expect(decision).to.equal('trigger-consolidation')
    })

    it('should use default options when none provided', () => {
      const gate = new BackpressureGate()

      // Default: maxEntriesPerFile=30, minConsolidationIntervalSec=300
      const decision = gate.evaluate({
        lastConsolidatedAt: '',
        projectedEntryCount: 25,
      })

      expect(decision).to.equal('accept')
    })

    it('should trigger when exactly at threshold', () => {
      const gate = new BackpressureGate({maxEntriesPerFile: 30})

      const decision = gate.evaluate({
        lastConsolidatedAt: '',
        projectedEntryCount: 30,
      })

      expect(decision).to.equal('trigger-consolidation')
    })
  })
})
