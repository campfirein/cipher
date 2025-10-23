import {expect} from 'chai'
import express from 'express'
import {Server} from 'node:http'

describe('Local HTTP Server - Learning Tests', () => {
  let server: Server

  afterEach((done) => {
    if (server) {
      server.close(done)
    } else {
      done()
    }
  })

  it('should create server on random available port', (done) => {
    const app = express()

    server = app.listen(0, () => {
      const address = server.address()
      if (address !== null && typeof address !== 'string') {
        expect(address.port).to.be.greaterThan(0)
        done()
      }
    })
  })

  it('should handle GET /callback route', (done) => {
    const app = express()
    let callbackReceived = false

    app.get('/callback', (_req, res) => {
      callbackReceived = true
      res.send('OK')
    })

    server = app.listen(0, () => {
      const address = server.address()
      if (address !== null && typeof address !== 'string') {
        const {port} = address

        // Simulate callback
        fetch(`http://localhost:${port}/callback?code=test-code&state=test-state`)
          .then(() => {
            expect(callbackReceived).to.be.true
            done()
          })
          .catch(done)
      }
    })
  })

  it('should extract query parameters from callback', (done) => {
    const app = express()
    let receivedCode: string | undefined
    let receivedState: string | undefined

    app.get('/callback', (req, res) => {
      receivedCode = req.query.code as string
      receivedState = req.query.state as string
      res.send('OK')
    })

    server = app.listen(0, () => {
      const address = server.address()
      if (address !== null && typeof address !== 'string') {
        const {port} = address

        fetch(`http://localhost:${port}/callback?code=auth-code-123&state=state-456`)
          .then(() => {
            expect(receivedCode).to.equal('auth-code-123')
            expect(receivedState).to.equal('state-456')
            done()
          })
          .catch(done)
      }
    })
  })
})
