import {expect} from 'chai'

import {ProviderCallbackServer} from '../../../../src/server/infra/provider-oauth/callback-server.js'
import {
  ProviderCallbackOAuthError,
  ProviderCallbackStateError,
  ProviderCallbackTimeoutError,
  ProviderOAuthError,
} from '../../../../src/server/infra/provider-oauth/errors.js'

describe('ProviderCallbackServer', () => {
  let server: ProviderCallbackServer | undefined

  afterEach(async () => {
    if (server !== undefined) {
      await server.stop()
    }
  })

  describe('start', () => {
    it('should start server on the configured port', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()
      expect(port).to.be.greaterThan(0)
    })

    it('should return port from getAddress when running', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()
      const address = server.getAddress()
      expect(address?.port).to.equal(port)
    })
  })

  describe('getAddress', () => {
    it('should return undefined when server is not started', () => {
      server = new ProviderCallbackServer({port: 0})
      expect(server.getAddress()).to.be.undefined
    })
  })

  describe('waitForCallback', () => {
    it('should resolve when valid callback is received', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/auth/callback?code=auth-code&state=test-state`)

      const result = await callbackPromise
      expect(result.code).to.equal('auth-code')
      expect(result.state).to.equal('test-state')
    })

    it('should auto-close server after receiving callback', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()
      expect(port).to.be.greaterThan(0)

      const callbackPromise = server.waitForCallback('test-state', 5000)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/auth/callback?code=auth-code&state=test-state`)

      await callbackPromise

      // Allow auto-close to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(server.getAddress()).to.be.undefined
    })

    it('should auto-close server after timeout', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.start()

      try {
        await server.waitForCallback('test-state', 100)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderCallbackTimeoutError)
      }

      // Allow auto-close to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(server.getAddress()).to.be.undefined
    })

    it('should reject with ProviderCallbackTimeoutError on timeout', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.start()

      try {
        await server.waitForCallback('test-state', 100)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderCallbackTimeoutError)
        if (error instanceof ProviderCallbackTimeoutError) {
          expect(error.timeoutMs).to.equal(100)
        }
      }
    })

    it('should reject with ProviderCallbackStateError on state mismatch', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('expected-state', 5000).catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/auth/callback?code=auth-code&state=wrong-state`)

      const error = await callbackPromise
      expect(error).to.be.instanceOf(ProviderCallbackStateError)
    })

    it('should reject with ProviderCallbackOAuthError when error param is present', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000).catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/auth/callback?error=access_denied&error_description=User+denied+access`)

      const error = await callbackPromise
      expect(error).to.be.instanceOf(ProviderCallbackOAuthError)
      if (error instanceof ProviderCallbackOAuthError) {
        expect(error.errorCode).to.equal('access_denied')
        expect(error.message).to.equal('User denied access')
      }
    })

    it('should reject with ProviderCallbackOAuthError using error code when no description', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000).catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/auth/callback?error=server_error`)

      const error = await callbackPromise
      expect(error).to.be.instanceOf(ProviderCallbackOAuthError)
      if (error instanceof ProviderCallbackOAuthError) {
        expect(error.message).to.include('server_error')
      }
    })

    it('should reject with ProviderOAuthError when code or state is missing', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000).catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const response = await fetch(`http://localhost:${port}/auth/callback?code=auth-code`)

      expect(response.status).to.equal(400)
      const error = await callbackPromise
      expect(error).to.be.instanceOf(ProviderOAuthError)
      if (error instanceof ProviderOAuthError) {
        expect(error.message).to.include('Missing code or state')
      }
    })

    it('should use custom callback path when configured', async () => {
      server = new ProviderCallbackServer({callbackPath: '/custom/path', port: 0})
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/custom/path?code=auth-code&state=test-state`)

      const result = await callbackPromise
      expect(result.code).to.equal('auth-code')
    })

    it('should return 404 for requests to non-callback paths', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const response = await fetch(`http://localhost:${port}/wrong/path`)
      expect(response.status).to.equal(404)
    })
  })

  describe('stop', () => {
    it('should stop the server', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.start()
      await server.stop()
      expect(server.getAddress()).to.be.undefined
    })

    it('should not throw when stopping server that is not started', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.stop()
    })

    it('should force-close active connections', async () => {
      server = new ProviderCallbackServer({port: 0})
      const port = await server.start()

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const fetchPromise = fetch(`http://localhost:${port}/auth/callback?code=test-code&state=test-state`)

      await new Promise((resolve) => {
        setTimeout(resolve, 25)
      })

      const startTime = Date.now()
      await server.stop()
      const elapsed = Date.now() - startTime
      expect(elapsed).to.be.lessThan(500)

      await fetchPromise.catch(() => {
        // Ignore errors from forcibly closed connection
      })
    })

    it('should allow restart after stop', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.start()
      await server.stop()

      const port2 = await server.start()
      expect(port2).to.be.greaterThan(0)
    })

    it('should reject pending waitForCallback promise when stopped', async () => {
      server = new ProviderCallbackServer({port: 0})
      await server.start()

      const callbackPromise = server.waitForCallback('test-state', 60_000).catch((error: Error) => error)

      await server.stop()

      const error = await callbackPromise
      expect(error).to.be.instanceOf(ProviderOAuthError)
      expect(error).to.not.be.instanceOf(ProviderCallbackTimeoutError)
      if (error instanceof ProviderOAuthError) {
        expect(error.message).to.include('stopped')
      }
    })
  })
})
