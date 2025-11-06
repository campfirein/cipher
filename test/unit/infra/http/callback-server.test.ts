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
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
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
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
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

    it('should stop the server quickly even with active connections', async () => {
      server = new CallbackServer()
      const port = await server.start()

      // Create an active HTTP connection that keeps alive
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const fetchPromise = fetch(`http://localhost:${port}/callback?code=test-code&state=test-state`)

      // Wait a bit to ensure connection is established
      await new Promise((resolve) => {
        setTimeout(resolve, 25)
      })

      // Stop should complete quickly even with active connection
      const startTime = Date.now()
      await server.stop()
      const elapsed = Date.now() - startTime

      // Should complete in less than 500ms
      expect(elapsed).to.be.lessThan(500)

      // Clean up the fetch promise
      await fetchPromise.catch(() => {
        // Ignore errors from forcibly closed connection
      })
    })

    it('should properly cleanup connections allowing restart', async () => {
      server = new CallbackServer()
      const port1 = await server.start()

      // Create active connections
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const fetch1 = fetch(`http://localhost:${port1}/callback?code=code1&state=state1`)
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const fetch2 = fetch(`http://localhost:${port1}/callback?code=code2&state=state2`)

      // Wait for connections to establish
      await new Promise((resolve) => {
        setTimeout(resolve, 25)
      })

      // Stop should cleanup all connections
      await server.stop()

      // Clean up fetch promises
      await Promise.allSettled([fetch1, fetch2])

      // Should be able to start again without connection leaks
      const port2 = await server.start()
      expect(port2).to.be.greaterThan(0)
      await server.stop()
    })
  })
})
