import type {Socket} from 'socket.io-client'

import {expect} from 'chai'

import {BrvApiClient} from '../../../../src/webui/lib/api-client.js'

/** Tiny socket stub that captures emits and lets us drive the ack callback. */
function makeStubSocket(
  ack: {code?: string; error?: string; success: boolean} | {data: unknown; success: true},
): Socket {
  return {
    emit(_event: string, _data: unknown, callback: (response: unknown) => void) {
      callback(ack)
      return this
    },
  } as unknown as Socket
}

describe('BrvApiClient.request', () => {
  it('rejects with an Error whose .code property matches the server code', async () => {
    const client = new BrvApiClient(
      makeStubSocket({code: 'ERR_VC_AUTH_FAILED', error: 'Authentication failed.', success: false}),
    )

    try {
      await client.request('vc:push')
      expect.fail('request should have rejected')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.equal('Authentication failed.')
      expect((error as Error & {code?: string}).code).to.equal('ERR_VC_AUTH_FAILED')
    }
  })

  it('rejects without a .code when the server response omits one', async () => {
    const client = new BrvApiClient(makeStubSocket({error: 'Request failed', success: false}))

    try {
      await client.request('vc:push')
      expect.fail('request should have rejected')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      expect((error as Error & {code?: string}).code).to.be.undefined
    }
  })
})
