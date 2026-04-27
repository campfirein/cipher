import {expect} from 'chai'

import {CallbackServer, escapeHtml, firstQueryParam} from '../../../../src/server/infra/http/callback-server.js'

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

      const callbackPromise = server.waitForCallback(internalState, 5000).catch((error: Error) => error)
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fetch(`http://localhost:${port}/callback?code=auth-code&state=${receivedState}`)

      const error = await callbackPromise
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('State mismatch')
    })
  })

  describe('callback HTML responses', () => {
    it('returns 200 + branded HTML body on successful callback', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const expectedState = 'state-success'
      const callbackPromise = server.waitForCallback(expectedState, 5000)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://localhost:${port}/callback?code=abc&state=${expectedState}`)
      const body = await res.text()
      await callbackPromise

      expect(res.status).to.equal(200)
      expect(res.headers.get('content-type') ?? '').to.include('text/html')
      expect(body).to.include('Authentication Successful')
      expect(body).to.include('BYTEROVER')
    })

    it('returns 400 + branded error HTML when provider returns error', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const errorPromise = server
        .waitForCallback('any-state', 5000)
        .catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://localhost:${port}/callback?error=access_denied&error_description=user%20denied%20access`,
      )
      const body = await res.text()
      await errorPromise

      expect(res.status).to.equal(400)
      expect(res.headers.get('content-type') ?? '').to.include('text/html')
      expect(body).to.include('Authentication Failed')
      expect(body).to.include('user denied access')
    })

    it('escapes HTML metacharacters in the error message', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const errorPromise = server
        .waitForCallback('any-state', 5000)
        .catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://localhost:${port}/callback?error=oops&error_description=` +
          encodeURIComponent('<script>alert("x")</script>'),
      )
      const body = await res.text()
      await errorPromise

      // Raw script tag must NOT appear; escaped form MUST appear in the .error-detail block.
      expect(body).to.not.include('<script>alert("x")</script>')
      expect(body).to.include('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    })

    it('returns 400 + error HTML when code or state is missing', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const errorPromise = server
        .waitForCallback('any-state', 5000)
        .catch((error: Error) => error)

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://localhost:${port}/callback?code=abc`) // no state
      const body = await res.text()
      await errorPromise

      expect(res.status).to.equal(400)
      expect(body).to.include('Missing code or state parameter')
    })
  })

  describe('escapeHtml', () => {
    it('escapes all five HTML metacharacters', () => {
      expect(escapeHtml('&')).to.equal('&amp;')
      expect(escapeHtml('<')).to.equal('&lt;')
      expect(escapeHtml('>')).to.equal('&gt;')
      expect(escapeHtml('"')).to.equal('&quot;')
      expect(escapeHtml("'")).to.equal('&#39;')
    })

    it('passes safe text through unchanged', () => {
      expect(escapeHtml('hello world 123')).to.equal('hello world 123')
      expect(escapeHtml('')).to.equal('')
    })

    it('escapes & first to avoid double-escaping subsequent entity prefixes', () => {
      // If `&` were escaped after `<`, the `&` in `&lt;` would become `&amp;lt;`.
      expect(escapeHtml('<a&b>')).to.equal('&lt;a&amp;b&gt;')
    })

    it('escapes a realistic XSS payload', () => {
      expect(escapeHtml(`<img src=x onerror="alert('p')">`)).to.equal(
        '&lt;img src=x onerror=&quot;alert(&#39;p&#39;)&quot;&gt;',
      )
    })
  })

  describe('firstQueryParam', () => {
    it('returns the string when given a string', () => {
      expect(firstQueryParam('hello')).to.equal('hello')
    })

    it('returns the first string when given an array of strings', () => {
      expect(firstQueryParam(['a', 'b'])).to.equal('a')
    })

    it('returns undefined when given an empty array', () => {
      expect(firstQueryParam([])).to.equal(undefined)
    })

    it('returns undefined when given an array whose first element is not a string', () => {
      // Express ParsedQs: ?error[code]=x parses to { error: { code: 'x' } } — guard refuses it.
      expect(firstQueryParam([{nested: 'x'}])).to.equal(undefined)
    })

    it('returns undefined for object / number / null / undefined inputs', () => {
      expect(firstQueryParam({foo: 'bar'})).to.equal(undefined)
      expect(firstQueryParam(42)).to.equal(undefined)
      expect(firstQueryParam(null)).to.equal(undefined)
      expect(firstQueryParam()).to.equal(undefined)
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
