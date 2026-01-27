import {expect} from 'chai'

import {createTransportClient, createTransportServer} from '../../../../src/server/infra/transport/transport-factory.js'

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

  describe('createTransportClient', () => {
    it('should create client with default config', () => {
      const client = createTransportClient()

      expect(client).to.exist
      expect(client.getState()).to.equal('disconnected')
    })

    it('should create client with custom config', () => {
      const client = createTransportClient({
        connectTimeoutMs: 1000,
        reconnectionAttempts: 5,
        reconnectionDelayMaxMs: 500,
        reconnectionDelayMs: 100,
        requestTimeoutMs: 5000,
        roomTimeoutMs: 1000,
      })

      expect(client).to.exist
    })
  })

  describe('Integration: factory-created instances work together', () => {
    it('should connect factory-created client to factory-created server', async () => {
      const server = createTransportServer()
      const client = createTransportClient()

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
