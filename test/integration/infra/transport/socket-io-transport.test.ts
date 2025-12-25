import {expect} from 'chai'

import {SocketIOTransportClient} from '../../../../src/infra/transport/socket-io-transport-client.js'
import {SocketIOTransportServer} from '../../../../src/infra/transport/socket-io-transport-server.js'

/**
 * Integration tests for Socket.IO Transport Layer.
 *
 * These tests verify end-to-end communication between server and multiple clients,
 * simulating real-world usage patterns as described in architecture-v7.
 */
describe('Socket.IO Transport Integration', () => {
  let server: SocketIOTransportServer
  const clients: SocketIOTransportClient[] = []
  const port = 9700

  beforeEach(async () => {
    server = new SocketIOTransportServer()
    await server.start(port)
  })

  afterEach(async () => {
    // Disconnect all clients in parallel
    await Promise.all(
      clients.filter((client) => client.getState() !== 'disconnected').map((client) => client.disconnect()),
    )

    clients.length = 0

    if (server.isRunning()) {
      await server.stop()
    }
  })

  function createClient(): SocketIOTransportClient {
    const client = new SocketIOTransportClient()
    clients.push(client)
    return client
  }

  describe('Multi-client communication (TUI + CLI scenario)', () => {
    it('should support multiple clients connecting simultaneously', async () => {
      const tui = createClient()
      const cli1 = createClient()
      const cli2 = createClient()

      await Promise.all([
        tui.connect(`http://127.0.0.1:${port}`),
        cli1.connect(`http://127.0.0.1:${port}`),
        cli2.connect(`http://127.0.0.1:${port}`),
      ])

      expect(tui.getState()).to.equal('connected')
      expect(cli1.getState()).to.equal('connected')
      expect(cli2.getState()).to.equal('connected')

      // All should have unique IDs
      const ids = new Set([cli1.getClientId(), cli2.getClientId(), tui.getClientId()])
      expect(ids.size).to.equal(3)
    })

    it('should broadcast to all clients (TUI receives all task events)', async () => {
      const tui = createClient()
      const cli = createClient()

      await Promise.all([tui.connect(`http://127.0.0.1:${port}`), cli.connect(`http://127.0.0.1:${port}`)])

      const tuiReceived: unknown[] = []
      const cliReceived: unknown[] = []

      tui.on('task:started', (data) => tuiReceived.push(data))
      cli.on('task:started', (data) => cliReceived.push(data))

      server.broadcast('task:started', {taskId: 'task-1'})

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(tuiReceived).to.deep.equal([{taskId: 'task-1'}])
      expect(cliReceived).to.deep.equal([{taskId: 'task-1'}])
    })

    it('should broadcast to specific room (CLI receives only its task events)', async () => {
      const tui = createClient()
      const cli1 = createClient()
      const cli2 = createClient()

      await Promise.all([
        tui.connect(`http://127.0.0.1:${port}`),
        cli1.connect(`http://127.0.0.1:${port}`),
        cli2.connect(`http://127.0.0.1:${port}`),
      ])

      // CLI1 joins its task room
      await cli1.joinRoom('task-abc')

      const tuiReceived: unknown[] = []
      const cli1Received: unknown[] = []
      const cli2Received: unknown[] = []

      tui.on('task:chunk', (data) => tuiReceived.push(data))
      cli1.on('task:chunk', (data) => cli1Received.push(data))
      cli2.on('task:chunk', (data) => cli2Received.push(data))

      // Broadcast to task-abc room only
      server.broadcastTo('task-abc', 'task:chunk', {content: 'Hello from agent'})

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // Only CLI1 (in room) should receive
      expect(cli1Received).to.deep.equal([{content: 'Hello from agent'}])
      expect(tuiReceived).to.be.empty
      expect(cli2Received).to.be.empty
    })
  })

  describe('Request/Response flow (task:create scenario)', () => {
    it('should handle task creation request and response', async () => {
      // Simulate Consumer handling task:create
      server.onRequest<{prompt: string; type: string}, {taskId: string}>('task:create', (_data, _clientId) => ({
        taskId: `task-${Date.now()}`,
      }))

      const cli = createClient()
      await cli.connect(`http://127.0.0.1:${port}`)

      const response = await cli.request<{taskId: string}>('task:create', {
        prompt: 'refactor auth',
        type: 'curate',
      })

      expect(response.taskId).to.match(/^task-\d+$/)
    })

    it('should track client ID in request handler', async () => {
      let receivedClientId: string | undefined

      server.onRequest('identify', (_data, clientId) => {
        receivedClientId = clientId
        return {identified: true}
      })

      const cli = createClient()
      await cli.connect(`http://127.0.0.1:${port}`)

      await cli.request('identify', {})

      expect(receivedClientId).to.equal(cli.getClientId())
    })
  })

  describe('Server-side room management (architecture 14: broadcast rules)', () => {
    it('should add client to room server-side for TUI global broadcasts', async () => {
      // Register connection handler BEFORE client connects
      let tuiClientId: string | undefined
      server.onConnection((clientId) => {
        tuiClientId = clientId
      })

      const tui = createClient()
      await tui.connect(`http://127.0.0.1:${port}`)

      // Wait for connection handler to be called
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // Server adds TUI to global room using the tracked client ID
      server.addToRoom(tuiClientId!, 'all-tasks')

      const tuiReceived: unknown[] = []
      tui.on('task:update', (data) => tuiReceived.push(data))

      // All task updates go to 'all-tasks' room
      server.broadcastTo('all-tasks', 'task:update', {status: 'running', taskId: 'task-1'})
      server.broadcastTo('all-tasks', 'task:update', {status: 'completed', taskId: 'task-2'})

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(tuiReceived).to.have.length(2)
    })
  })

  describe('Connection lifecycle', () => {
    it('should track connections and disconnections', async () => {
      const connected: string[] = []
      const disconnected: string[] = []

      server.onConnection((clientId) => connected.push(clientId))
      server.onDisconnection((clientId) => disconnected.push(clientId))

      const cli = createClient()
      await cli.connect(`http://127.0.0.1:${port}`)

      expect(connected).to.have.length(1)
      expect(connected[0]).to.equal(cli.getClientId())

      await cli.disconnect()

      // Wait for disconnect event
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      expect(disconnected).to.have.length(1)
      expect(disconnected[0]).to.equal(connected[0])
    })

    it('should handle server stop gracefully', async () => {
      const cli1 = createClient()
      const cli2 = createClient()

      await Promise.all([cli1.connect(`http://127.0.0.1:${port}`), cli2.connect(`http://127.0.0.1:${port}`)])

      await server.stop()

      // Wait for clients to detect disconnection
      await new Promise((resolve) => {
        setTimeout(resolve, 15)
      })

      // Clients should detect disconnection
      expect(cli1.getState()).to.be.oneOf(['disconnected', 'reconnecting'])
      expect(cli2.getState()).to.be.oneOf(['disconnected', 'reconnecting'])
    })
  })

  describe('Error handling', () => {
    it('should handle request handler errors gracefully', async () => {
      server.onRequest('crash', () => {
        throw new Error('Handler crashed')
      })

      const cli = createClient()
      await cli.connect(`http://127.0.0.1:${port}`)

      try {
        await cli.request('crash', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('Handler crashed')
      }

      // Client should still be connected
      expect(cli.getState()).to.equal('connected')
    })
  })

  describe('Real-world scenario: Task flow', () => {
    it('should simulate complete task flow from CLI to Agent', async () => {
      // Setup: TUI and CLI connected
      const tui = createClient()
      const cli = createClient()

      await Promise.all([tui.connect(`http://127.0.0.1:${port}`), cli.connect(`http://127.0.0.1:${port}`)])

      // TUI joins all-tasks room to receive all events
      await tui.joinRoom('all-tasks')

      const tuiEvents: Array<{data: unknown; event: string}> = []
      const cliEvents: Array<{data: unknown; event: string}> = []

      for (const event of ['task:ack', 'task:started', 'task:chunk', 'task:completed']) {
        tui.on(event, (data) => tuiEvents.push({data, event}))
        cli.on(event, (data) => cliEvents.push({data, event}))
      }

      // 1. CLI sends task:create
      let taskId: string | undefined

      server.onRequest<{prompt: string}, {taskId: string}>('task:create', (_data, clientId) => {
        taskId = `task-${Date.now()}`

        // 2. Immediately send task:ack to requesting client (via room)
        server.addToRoom(clientId, taskId)

        // Simulate async: ack first
        setImmediate(() => {
          server.broadcastTo(taskId!, 'task:ack', {taskId})
          server.broadcastTo('all-tasks', 'task:ack', {taskId})
        })

        return {taskId}
      })

      await cli.request('task:create', {prompt: 'test task'})
      await cli.joinRoom(taskId!)

      // Wait for ack
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // 3. Simulate agent starting
      server.broadcastTo(taskId!, 'task:started', {taskId})
      server.broadcastTo('all-tasks', 'task:started', {taskId})

      // 4. Simulate agent sending chunks
      server.broadcastTo(taskId!, 'task:chunk', {content: 'Working...', taskId})
      server.broadcastTo('all-tasks', 'task:chunk', {content: 'Working...', taskId})

      // 5. Simulate task completion
      server.broadcastTo(taskId!, 'task:completed', {result: 'Done', taskId})
      server.broadcastTo('all-tasks', 'task:completed', {result: 'Done', taskId})

      // Wait for all events
      await new Promise((resolve) => {
        setTimeout(resolve, 15)
      })

      // TUI should receive all events (via all-tasks room)
      expect(tuiEvents.map((e) => e.event)).to.deep.equal(['task:ack', 'task:started', 'task:chunk', 'task:completed'])

      // CLI should receive events for its task (via task room)
      expect(cliEvents.map((e) => e.event)).to.deep.equal(['task:ack', 'task:started', 'task:chunk', 'task:completed'])
    })
  })
})
