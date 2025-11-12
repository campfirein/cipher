import {expect} from 'chai'

import {CallbackHandler} from '../../../../src/infra/http/callback-handler.js'

describe('CallbackHandler', () => {
  let handler: CallbackHandler | undefined

  afterEach(async () => {
    if (handler !== undefined) {
      await handler.stop()
    }
  })

  describe('start', () => {
    it('should start server on random port', async () => {
      handler = new CallbackHandler()
      const port = await handler.start()

      expect(port).to.be.greaterThan(0)
    })

    it('should return port via getPort() when server is started', async () => {
      handler = new CallbackHandler()
      const port = await handler.start()
      const retrievedPort = handler.getPort()

      expect(retrievedPort).to.equal(port)
    })

    it('should return undefined via getPort() when server is not started', () => {
      handler = new CallbackHandler()
      const port = handler.getPort()

      expect(port).to.be.undefined
    })
  })

  describe('waitForCallback', () => {
    it('should resolve when valid callback is received', async () => {
      handler = new CallbackHandler()
      const port = await handler.start()

      const internalCode = 'auth-code-123'
      const internalState = 'secure-state-456'

      const callbackPromise = handler.waitForCallback(internalState, 5000)

      // Simulate OAuth callback
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/callback?code=${internalCode}&state=${internalState}`)

      const result = await callbackPromise

      expect(result.code).to.equal(internalCode)
      expect(result.state).to.equal(internalState)
    })

    it('should reject on state mismatch (CSRF protection)', async () => {
      handler = new CallbackHandler()
      const port = await handler.start()
      const expectedState = 'expected-state'
      const receivedState = 'malicious-state'

      const callbackPromise = handler.waitForCallback(expectedState, 5000).catch((error: Error) => error)
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/callback?code=auth-code&state=${receivedState}`)

      const error = await callbackPromise
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('State mismatch')
    })

    it('should reject on timeout', async () => {
      handler = new CallbackHandler()
      await handler.start()

      try {
        await handler.waitForCallback('test-state', 25)
        expect.fail('Should have thrown timeout error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Authentication timeout')
      }
    })
  })

  describe('stop', () => {
    it('should stop the server', async () => {
      handler = new CallbackHandler()
      await handler.start()
      await handler.stop()

      const port = handler.getPort()
      expect(port).to.be.undefined
    })

    it('should not throw when stopping server that is not started', async () => {
      handler = new CallbackHandler()
      await handler.stop() // Should not throw
    })
  })
})
