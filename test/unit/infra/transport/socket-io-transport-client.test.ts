import {expect} from 'chai'

import type {ConnectionState} from '../../../../src/core/interfaces/transport/index.js'

import {
  TransportConnectionError,
  TransportNotConnectedError,
  TransportRequestTimeoutError,
} from '../../../../src/core/domain/errors/transport-error.js'
import {SocketIOTransportClient} from '../../../../src/infra/transport/socket-io-transport-client.js'
import {SocketIOTransportServer} from '../../../../src/infra/transport/socket-io-transport-server.js'

describe('SocketIOTransportClient', () => {
  let server: SocketIOTransportServer
  let client: SocketIOTransportClient
  const basePort = 9800

  beforeEach(async () => {
    server = new SocketIOTransportServer()
    client = new SocketIOTransportClient()
  })

  afterEach(async () => {
    if (client.getState() !== 'disconnected') {
      await client.disconnect()
    }

    if (server.isRunning()) {
      await server.stop()
    }
  })

  describe('connect', () => {
    it('should connect to server', async () => {
      await server.start(basePort)

      await client.connect(`http://127.0.0.1:${basePort}`)

      expect(client.getState()).to.equal('connected')
      expect(client.getClientId()).to.be.a('string')
    })

    it('should be idempotent when already connected', async () => {
      await server.start(basePort + 1)

      await client.connect(`http://127.0.0.1:${basePort + 1}`)
      const firstId = client.getClientId()

      await client.connect(`http://127.0.0.1:${basePort + 1}`)
      const secondId = client.getClientId()

      expect(firstId).to.equal(secondId)
    })

    it('should fail when server is not available', async () => {
      try {
        await client.connect('http://127.0.0.1:9999')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(TransportConnectionError)
        expect((error as TransportConnectionError).name).to.equal('TransportConnectionError')
        expect((error as TransportConnectionError).url).to.equal('http://127.0.0.1:9999')
      }
    }).timeout(25_000)

    it('should update state to connecting then connected', async () => {
      await server.start(basePort + 2)

      const states: ConnectionState[] = []
      client.onStateChange((state) => {
        states.push(state)
      })

      await client.connect(`http://127.0.0.1:${basePort + 2}`)

      expect(states).to.include('connecting')
      expect(states).to.include('connected')
    })
  })

  describe('disconnect', () => {
    it('should disconnect from server', async () => {
      await server.start(basePort + 10)
      await client.connect(`http://127.0.0.1:${basePort + 10}`)

      await client.disconnect()

      expect(client.getState()).to.equal('disconnected')
      expect(client.getClientId()).to.be.undefined
    })

    it('should be safe to call when not connected', async () => {
      await client.disconnect()
      expect(client.getState()).to.equal('disconnected')
    })
  })

  describe('request', () => {
    it('should send request and receive response', async () => {
      await server.start(basePort + 20)

      server.onRequest<{a: number; b: number}, {sum: number}>('add', (data) => ({sum: data.a + data.b}))

      await client.connect(`http://127.0.0.1:${basePort + 20}`)

      const result = await client.request<{sum: number}>('add', {a: 3, b: 4})

      expect(result.sum).to.equal(7)
    })

    it('should throw error on server error', async () => {
      await server.start(basePort + 21)

      server.onRequest('fail', () => {
        throw new Error('Intentional failure')
      })

      await client.connect(`http://127.0.0.1:${basePort + 21}`)

      try {
        await client.request('fail', {})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Intentional failure')
      }
    })

    it('should timeout on slow response', async () => {
      await server.start(basePort + 22)

      server.onRequest('slow', async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 5000)
        })
        return {}
      })

      await client.connect(`http://127.0.0.1:${basePort + 22}`)

      try {
        await client.request('slow', {}, {timeout: 100})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(TransportRequestTimeoutError)
        expect((error as TransportRequestTimeoutError).name).to.equal('TransportRequestTimeoutError')
        expect((error as TransportRequestTimeoutError).event).to.equal('slow')
        expect((error as TransportRequestTimeoutError).timeoutMs).to.equal(100)
      }
    })

    it('should throw error when not connected', async () => {
      try {
        await client.request('test', {})
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(TransportNotConnectedError)
        expect((error as TransportNotConnectedError).name).to.equal('TransportNotConnectedError')
      }
    })
  })

  describe('on (event subscription)', () => {
    it('should receive broadcast events', async () => {
      await server.start(basePort + 30)
      await client.connect(`http://127.0.0.1:${basePort + 30}`)

      const received = new Promise<{message: string}>((resolve) => {
        client.on<{message: string}>('notification', resolve)
      })

      server.broadcast('notification', {message: 'test'})

      const data = await received
      expect(data.message).to.equal('test')
    })

    it('should return unsubscribe function', async () => {
      await server.start(basePort + 31)
      await client.connect(`http://127.0.0.1:${basePort + 31}`)

      let callCount = 0
      const unsubscribe = client.on('event', () => {
        callCount++
      })

      server.broadcast('event', {})
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(callCount).to.equal(1)

      unsubscribe()
      server.broadcast('event', {})
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(callCount).to.equal(1) // Should not increase
    })

    it('should support multiple handlers for same event', async () => {
      await server.start(basePort + 32)
      await client.connect(`http://127.0.0.1:${basePort + 32}`)

      let handler1Called = false
      let handler2Called = false

      client.on('multi', () => {
        handler1Called = true
      })
      client.on('multi', () => {
        handler2Called = true
      })

      server.broadcast('multi', {})
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })

      expect(handler1Called).to.be.true
      expect(handler2Called).to.be.true
    })
  })

  describe('once', () => {
    it('should only trigger once', async () => {
      await server.start(basePort + 40)
      await client.connect(`http://127.0.0.1:${basePort + 40}`)

      let callCount = 0
      client.once('single', () => {
        callCount++
      })

      server.broadcast('single', {})
      server.broadcast('single', {})

      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      expect(callCount).to.equal(1)
    })

    it('should throw error when not connected', () => {
      expect(() => client.once('test', () => {})).to.throw(TransportNotConnectedError)
    })
  })

  describe('joinRoom and leaveRoom', () => {
    it('should join room and receive targeted broadcasts', async () => {
      await server.start(basePort + 50)
      await client.connect(`http://127.0.0.1:${basePort + 50}`)

      await client.joinRoom('task-abc')

      const received = new Promise<{status: string}>((resolve) => {
        client.on<{status: string}>('task:status', resolve)
      })

      server.broadcastTo('task-abc', 'task:status', {status: 'running'})

      const data = await received
      expect(data.status).to.equal('running')
    })

    it('should not receive broadcasts after leaving room', async () => {
      await server.start(basePort + 51)
      await client.connect(`http://127.0.0.1:${basePort + 51}`)

      await client.joinRoom('temp-room')
      await client.leaveRoom('temp-room')

      let received = false
      client.on('temp:event', () => {
        received = true
      })

      server.broadcastTo('temp-room', 'temp:event', {})

      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      expect(received).to.be.false
    })

    it('should throw error when not connected', async () => {
      try {
        await client.joinRoom('test')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(TransportNotConnectedError)
        expect((error as TransportNotConnectedError).name).to.equal('TransportNotConnectedError')
      }
    })
  })

  describe('onStateChange', () => {
    it('should notify on state changes', async () => {
      await server.start(basePort + 60)

      const states: ConnectionState[] = []
      client.onStateChange((state) => {
        states.push(state)
      })

      await client.connect(`http://127.0.0.1:${basePort + 60}`)
      await client.disconnect()

      expect(states).to.deep.equal(['connecting', 'connected', 'disconnected'])
    })

    it('should return unsubscribe function', async () => {
      await server.start(basePort + 61)

      const states: ConnectionState[] = []
      const unsubscribe = client.onStateChange((state) => {
        states.push(state)
      })

      unsubscribe()

      await client.connect(`http://127.0.0.1:${basePort + 61}`)

      expect(states).to.be.empty
    })
  })

  describe('getState and getClientId', () => {
    it('should return disconnected when not connected', () => {
      expect(client.getState()).to.equal('disconnected')
      expect(client.getClientId()).to.be.undefined
    })

    it('should return connected state and client ID when connected', async () => {
      await server.start(basePort + 70)
      await client.connect(`http://127.0.0.1:${basePort + 70}`)

      expect(client.getState()).to.equal('connected')
      expect(client.getClientId()).to.be.a('string')
      expect(client.getClientId()!.length).to.be.greaterThan(0)
    })
  })
})
