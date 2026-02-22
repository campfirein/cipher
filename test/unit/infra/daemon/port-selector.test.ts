import {expect} from 'chai'

import {DYNAMIC_PORT_MAX, DYNAMIC_PORT_MIN} from '../../../../src/server/constants.js'
import {selectDaemonPort} from '../../../../src/server/infra/daemon/port-selector.js'

/** Checker that always returns false (all ports occupied). */
const alwaysOccupied = async (_port: number): Promise<boolean> => false

describe('port-selector', () => {
  describe('selectDaemonPort()', () => {
    it('should find an available port in dynamic range', async () => {
      const result = await selectDaemonPort()
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.port).to.be.at.least(DYNAMIC_PORT_MIN)
        expect(result.port).to.be.at.most(DYNAMIC_PORT_MAX)
      }
    })

    it('should return first available port from batch', async () => {
      const targetPort = 50_005
      const checker = async (port: number): Promise<boolean> => port === targetPort

      const result = await selectDaemonPort({
        checker,
        portMax: 50_010,
        portMin: 50_000,
      })

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.port).to.equal(targetPort)
      }
    })

    it('should check ports in parallel within a batch', async () => {
      const checked: number[] = []
      let resolveCount = 0

      const checker = async (port: number): Promise<boolean> => {
        checked.push(port)
        resolveCount++
        // All ports available — first found wins
        return true
      }

      const result = await selectDaemonPort({
        batchSize: 5,
        checker,
        portMax: 50_010,
        portMin: 50_000,
      })

      expect(result.success).to.be.true
      // All 5 ports in the batch should have been checked (parallel)
      expect(resolveCount).to.equal(5)
    })

    it('should retry with new batch when first batch all occupied', async () => {
      let attempt = 0

      const checker = async (_port: number): Promise<boolean> => {
        attempt++
        // First 3 checks fail, 4th succeeds
        return attempt >= 4
      }

      const result = await selectDaemonPort({
        batchSize: 3,
        checker,
        maxAttempts: 5,
        portMax: 50_100,
        portMin: 50_000,
      })

      expect(result.success).to.be.true
      // First batch (3 checks) all fail, second batch should have the 4th check succeed
      expect(attempt).to.be.at.least(4)
    })

    it('should return failure after max attempts exhausted', async () => {
      const result = await selectDaemonPort({
        batchSize: 3,
        checker: alwaysOccupied,
        maxAttempts: 2,
        portMax: 50_010,
        portMin: 50_000,
      })

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('all_ports_occupied')
      }
    })

    it('should generate unique ports within the specified range', async () => {
      const checkedPorts = new Set<number>()

      const checker = async (port: number): Promise<boolean> => {
        checkedPorts.add(port)
        return false // Force all attempts to fail so we can inspect all checked ports
      }

      await selectDaemonPort({
        batchSize: 5,
        checker,
        maxAttempts: 1,
        portMax: 50_010,
        portMin: 50_000,
      })

      // All checked ports should be unique (Set size = array of calls)
      expect(checkedPorts.size).to.equal(5)
      for (const port of checkedPorts) {
        expect(port).to.be.at.least(50_000)
        expect(port).to.be.at.most(50_010)
      }
    })
  })
})
