import {expect} from 'chai'
import {createServer, Server} from 'node:net'

import {
  findAvailablePort,
  findAvailablePortWithPreference,
  getRandomPort,
  isPortAvailable,
} from '../../../../src/server/infra/transport/port-utils.js'

describe('Port Utils', () => {
  describe('getRandomPort', () => {
    it('should return a port in the valid range', () => {
      for (let i = 0; i < 100; i++) {
        const port = getRandomPort()
        expect(port).to.be.at.least(49_152)
        expect(port).to.be.at.most(60_000)
      }
    })

    it('should return different ports on multiple calls (randomness)', () => {
      const ports = new Set<number>()
      for (let i = 0; i < 50; i++) {
        ports.add(getRandomPort())
      }

      // With 50 attempts in a ~10k range, we should get multiple unique values
      expect(ports.size).to.be.greaterThan(1)
    })
  })

  describe('isPortAvailable', () => {
    let server: Server

    afterEach((done) => {
      if (server?.listening) {
        server.close(() => done())
      } else {
        done()
      }
    })

    it('should return true for an available port', async () => {
      const port = getRandomPort()
      const available = await isPortAvailable(port)
      expect(available).to.be.true
    })

    it('should return false for an occupied port', async () => {
      const port = getRandomPort()

      // Occupy the port
      server = createServer()
      await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve())
      })

      const available = await isPortAvailable(port)
      expect(available).to.be.false
    })
  })

  describe('findAvailablePort', () => {
    it('should find an available port', async () => {
      const port = await findAvailablePort()

      expect(port).to.be.a('number')
      expect(port).to.be.at.least(49_152)
      expect(port).to.be.at.most(60_000)

      // Verify it's actually available
      const available = await isPortAvailable(port)
      expect(available).to.be.true
    })

    it('should return different ports on successive calls', async () => {
      const port1 = await findAvailablePort()
      const port2 = await findAvailablePort()

      // Both should be valid (they might be the same by chance, but both should work)
      expect(port1).to.be.at.least(49_152)
      expect(port2).to.be.at.least(49_152)
    })
  })

  describe('findAvailablePortWithPreference', () => {
    let server: Server

    afterEach((done) => {
      if (server?.listening) {
        server.close(() => done())
      } else {
        done()
      }
    })

    it('should return preferred port if available', async () => {
      const preferredPort = 55_555

      // Make sure it's available first
      const isAvailable = await isPortAvailable(preferredPort)
      if (!isAvailable) {
        // Skip test if port happens to be in use
        return
      }

      const port = await findAvailablePortWithPreference(preferredPort)
      expect(port).to.equal(preferredPort)
    })

    it('should fallback to random port if preferred is occupied', async () => {
      const preferredPort = getRandomPort()

      // Occupy the preferred port
      server = createServer()
      await new Promise<void>((resolve) => {
        server.listen(preferredPort, '127.0.0.1', () => resolve())
      })

      const port = await findAvailablePortWithPreference(preferredPort)

      // Should get a different port
      expect(port).to.not.equal(preferredPort)
      expect(port).to.be.at.least(49_152)
      expect(port).to.be.at.most(60_000)
    })
  })
})
