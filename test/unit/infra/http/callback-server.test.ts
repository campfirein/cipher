import {expect} from 'chai'

import {CallbackServer} from '../../../../src/infra/http/callback-server'

describe('CallbackServer', () => {
  let server: CallbackServer | undefined

  afterEach(async () => {
    if (server !== undefined) {
      await server.stop()
    }
  })

  describe('start', () => {
    it('should start server on random port', async () => {
      server = new CallbackServer()
      const port = await server.start()

      expect(port).to.be.greaterThan(0)
    })

    it('should return port when server is started', async () => {
      server = new CallbackServer()
      const port = await server.start()
      const address = server.getAddress()
      expect(address?.port).to.equal(port)
    })
  })

  describe('waitForCallback', () => {
    it('should resolve when callback is received', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const internalCode = 'auth-code'
      const internalState = 'test-state'

      const callbackPromise = server.waitForCallback(internalState, 5000)

      // Simulate OAuth callback
      await fetch(`http://localhost:${port}/callback?code=${internalCode}&state=${internalState}`)

      const result = await callbackPromise

      expect(result.code).to.equal(internalCode)
      expect(result.state).to.equal(internalState)
    })

    it('should reject on timeout', async () => {
      server = new CallbackServer()
      await server.start()

      try {
        server.waitForCallback('test-state', 100)
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Authentication timeout')
      }
    })

    it('should reject on state mismatch', async () => {
      server = new CallbackServer()
      const port = await server.start()
      const internalState = 'expected-state'
      const receivedState = 'wrong-state'

      const callbackPromise = server.waitForCallback(internalState, 5000).catch((error) => error)
      await fetch(`http://localhost:${port}/callback?code=auth-code&state=${receivedState}`)

      const error = await callbackPromise
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('State mismatch')
    })
  })

  describe('stop', () => {
    it('should stop the server', async () => {
      server = new CallbackServer()
      await server.start()
      await server.stop()

      const address = server.getAddress()
      expect(address).to.be.undefined
    })
  })
})
