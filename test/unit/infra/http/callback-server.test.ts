import {expect} from 'chai'

import {CallbackServer} from '../../../../src/infra/http/callback-server.js'

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
})
