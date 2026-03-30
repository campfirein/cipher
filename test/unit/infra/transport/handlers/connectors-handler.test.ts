import type {SinonStub, SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {ConnectorsHandler} from '../../../../../src/server/infra/transport/handlers/connectors-handler.js'
import {ConnectorEvents} from '../../../../../src/shared/transport/events/connector-events.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub(),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

// ==================== Tests ====================

describe('ConnectorsHandler', () => {
  let resolveProjectPath: SinonStub
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): ConnectorsHandler {
    const connectorManagerFactory = stub().returns({
      getAllInstalledConnectors: stub().resolves(new Map()),
      getConnector: stub().returns({getConfigPath: stub().returns('/path')}),
      getDefaultConnectorType: stub().returns('skill'),
      getSupportedConnectorTypes: stub().returns([]),
      switchConnector: stub().resolves({installResult: {}, message: 'ok', success: true}),
    })
    const handler = new ConnectorsHandler({
      connectorManagerFactory,
      resolveProjectPath,
      transport,
    })
    handler.setup()

    return handler
  }

  describe('setup', () => {
    it('should register connector handlers (no SYNC)', () => {
      createHandler()
      expect(transport._handlers.has(ConnectorEvents.GET_AGENTS)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.LIST)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.INSTALL)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.GET_AGENT_CONFIG_PATHS)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.SYNC)).to.be.false
    })
  })
})
