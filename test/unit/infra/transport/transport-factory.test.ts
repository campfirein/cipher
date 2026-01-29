import {TransportClient} from '@campfirein/brv-transport-client'
import {expect} from 'chai'

import {createTransportServer} from '../../../../src/infra/transport/transport-factory.js'

describe('Transport Factory', () => {
  describe('createTransportServer', () => {
    it('should create server with default config', () => {
      const server = createTransportServer()

      expect(server).to.exist
      expect(server.isRunning()).to.be.false
    })

    it('should create server with custom config', () => {
      const server = createTransportServer({
        corsOrigin: 'http://localhost:3000',
        pingIntervalMs: 2000,
        pingTimeoutMs: 1500,
      })

      expect(server).to.exist
    })
  })

  // Note: createTransportClient was removed from transport-factory.ts
  // For client usage, use connectToTransport() from @campfirein/brv-transport-client
  // or TransportClient directly for low-level access (e.g., agent-worker, status-use-case)

  describe('Integration: server with package client', () => {
    it('should connect TransportClient from package to local server', async () => {
      const server = createTransportServer()
      const client = new TransportClient()

      await server.start(9980)

      try {
        await client.connect('http://127.0.0.1:9980')

        expect(client.getState()).to.equal('connected')
        expect(client.getClientId()).to.be.a('string')
      } finally {
        await client.disconnect()
        await server.stop()
      }
    })
  })
})
