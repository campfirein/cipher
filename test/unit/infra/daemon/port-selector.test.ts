import {expect} from 'chai'
import {createServer, type Server} from 'node:net'

import {
  DAEMON_PORT_RANGE_MAX,
  DAEMON_PORT_RANGE_MIN,
  DAEMON_PREFERRED_PORT,
} from '../../../../src/server/constants.js'
import {selectDaemonPort} from '../../../../src/server/infra/daemon/port-selector.js'

/**
 * Helper to occupy a port by binding a TCP server.
 */
function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.once('listening', () => resolve(server))
    server.listen(port, '127.0.0.1')
  })
}

describe('port-selector', () => {
  describe('selectDaemonPort()', () => {
    it('should return preferred port (37847) when available', async () => {
      const result = await selectDaemonPort()
      expect(result.success).to.be.true
      if (result.success) {
        // Port 37847 should be available in test environment
        expect(result.port).to.equal(37_847)
      }
    })

    it('should fallback when preferred port is occupied', async () => {
      const blocker = await occupyPort(37_847)
      try {
        const result = await selectDaemonPort()
        expect(result.success).to.be.true
        if (result.success) {
          expect(result.port).to.equal(37_848)
        }
      } finally {
        await new Promise<void>((resolve) => {
          blocker.close(() => resolve())
        })
      }
    })

    it('should scan sequentially through fallback range', async () => {
      const blockers: Server[] = []
      try {
        // Block 37847, 37848, 37849
        blockers.push(await occupyPort(37_847), await occupyPort(37_848), await occupyPort(37_849))

        const result = await selectDaemonPort()
        expect(result.success).to.be.true
        if (result.success) {
          expect(result.port).to.equal(37_850)
        }
      } finally {
        await Promise.all(
          blockers.map(
            (s) =>
              new Promise<void>((resolve) => {
                s.close(() => resolve())
              }),
          ),
        )
      }
    })

    it('should return failure when all ports are occupied', async () => {
      const blockers: Server[] = []
      try {
        // Block every port in the range: preferred + fallback range
        const portsToBlock = [DAEMON_PREFERRED_PORT]
        for (let p = DAEMON_PORT_RANGE_MIN; p <= DAEMON_PORT_RANGE_MAX; p++) {
          portsToBlock.push(p)
        }

        for (const port of portsToBlock) {
          // eslint-disable-next-line no-await-in-loop
          blockers.push(await occupyPort(port))
        }

        const result = await selectDaemonPort()
        expect(result.success).to.be.false
        if (!result.success) {
          expect(result.reason).to.equal('all_ports_occupied')
        }
      } finally {
        await Promise.all(
          blockers.map(
            (s) =>
              new Promise<void>((resolve) => {
                s.close(() => resolve())
              }),
          ),
        )
      }
    })
  })
})
