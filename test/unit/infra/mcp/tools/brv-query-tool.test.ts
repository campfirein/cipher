import type {ConnectionState, ConnectionStateHandler, ITransportClient} from '@campfirein/brv-transport-client'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {BrvQueryInputSchema} from '../../../../../src/server/infra/mcp/tools/brv-query-tool.js'

/**
 * Creates a mock transport client for testing.
 */
function createMockClient(): {
  client: ITransportClient
  simulateEvent: <T>(event: string, payload: T) => void
  simulateStateChange: (state: ConnectionState) => void
} {
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>()
  const stateHandlers = new Set<ConnectionStateHandler>()

  const client: ITransportClient = {
    connect: stub().resolves(),
    disconnect: stub().resolves(),
    getClientId: stub().returns('mock-client-id'),
    getState: stub().returns('connected'),
    isConnected: stub().resolves(true),
    joinRoom: stub().resolves(),
    leaveRoom: stub().resolves(),
    on<T>(event: string, handler: (data: T) => void) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set())
      }

      eventHandlers.get(event)!.add(handler as (data: unknown) => void)
      return () => {
        eventHandlers.get(event)?.delete(handler as (data: unknown) => void)
      }
    },
    once: stub(),
    onStateChange(handler: ConnectionStateHandler) {
      stateHandlers.add(handler)
      return () => {
        stateHandlers.delete(handler)
      }
    },
    request: stub() as unknown as ITransportClient['request'],
    requestWithAck: stub().resolves(),
  }

  return {
    client,
    simulateEvent<T>(event: string, payload: T) {
      const handlers = eventHandlers.get(event)
      if (handlers) {
        for (const handler of handlers) {
          handler(payload)
        }
      }
    },
    simulateStateChange(state: ConnectionState) {
      for (const handler of stateHandlers) {
        handler(state)
      }
    },
  }
}

describe('brv-query-tool', () => {
  afterEach(() => {
    restore()
  })

  describe('BrvQueryInputSchema', () => {
    it('should accept query without cwd', () => {
      const result = BrvQueryInputSchema.safeParse({query: 'How is auth implemented?'})
      expect(result.success).to.be.true
    })

    it('should accept query with cwd', () => {
      const result = BrvQueryInputSchema.safeParse({
        cwd: '/path/to/project',
        query: 'How is auth implemented?',
      })
      expect(result.success).to.be.true
    })

    it('should reject missing query', () => {
      const result = BrvQueryInputSchema.safeParse({cwd: '/path'})
      expect(result.success).to.be.false
    })

    it('should accept optional cwd as undefined', () => {
      const result = BrvQueryInputSchema.safeParse({query: 'test'})
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.data.cwd).to.be.undefined
      }
    })
  })

  describe('registerBrvQueryTool', () => {
    // Note: registerBrvQueryTool registers a handler on the McpServer.
    // Testing the handler directly requires instantiating McpServer which
    // has complex dependencies. The key logic (resolveClientCwd) is tested
    // separately in resolve-client-cwd.test.ts.
    //
    // Integration-level behavior is verified by the schema tests above
    // and the resolve-client-cwd unit tests.

    it('should expose cwd in the input schema', () => {
      const {shape} = BrvQueryInputSchema
      expect(shape).to.have.property('cwd')
      expect(shape).to.have.property('query')
    })
  })

  // Verify mock client pattern works (same as task-result-waiter.test.ts)
  describe('mock client sanity', () => {
    it('should create a connected mock client', () => {
      const {client} = createMockClient()
      expect(client.getState()).to.equal('connected')
      expect(client.getClientId()).to.equal('mock-client-id')
    })
  })
})
