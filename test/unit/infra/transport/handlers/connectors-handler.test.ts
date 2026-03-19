import type {SinonStub, SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {SkillExportStack} from '../../../../../src/server/infra/connectors/skill/create-skill-export-stack.js'

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

function makeSkillExportStack(overrides: {
  buildResult?: string
  syncResult?: {failed: unknown[]; updated: unknown[]}
} = {}): {factory: SinonStub; stack: SkillExportStack} {
  const block = overrides.buildResult ?? 'built knowledge block'
  const syncResult = overrides.syncResult ?? {failed: [], updated: []}
  const buildAndSync = stub().resolves({block, ...syncResult})

  const stack = {
    builder: {build: stub().resolves(block)},
    coordinator: {buildAndSync},
    service: {syncInstalledTargets: stub().resolves(syncResult)},
    store: {},
  } as unknown as SkillExportStack

  const factory = stub().resolves(stack)
  return {factory, stack}
}

// ==================== Tests ====================

describe('ConnectorsHandler', () => {
  let resolveProjectPath: ReturnType<typeof stub>
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    resolveProjectPath = stub().returns('/test/project')
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(skillExportStackFactory = makeSkillExportStack().factory): ConnectorsHandler {
    const connectorManagerFactory = stub().returns({
      getAllInstalledConnectors: stub().resolves(new Map()),
      getDefaultConnectorType: stub().returns('skill'),
      getSupportedConnectorTypes: stub().returns([]),
    })
    const handler = new ConnectorsHandler({
      connectorManagerFactory,
      resolveProjectPath,
      skillExportStackFactory,
      transport,
    })
    handler.setup()
    return handler
  }

  async function callSyncHandler(
    clientId = 'client-1',
    factoryStub = makeSkillExportStack().factory,
  ): Promise<{block: string; failed: unknown[]; updated: unknown[]}> {
    createHandler(factoryStub)
    const handler = transport._handlers.get(ConnectorEvents.SYNC)
    expect(handler, 'connectors:sync handler should be registered').to.exist
    return handler!(undefined, clientId)
  }

  describe('setup', () => {
    it('should register connectors:sync handler', () => {
      createHandler()
      expect(transport._handlers.has(ConnectorEvents.SYNC)).to.be.true
    })

    it('should register all other connector handlers', () => {
      createHandler()
      expect(transport._handlers.has(ConnectorEvents.GET_AGENTS)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.LIST)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.INSTALL)).to.be.true
      expect(transport._handlers.has(ConnectorEvents.GET_AGENT_CONFIG_PATHS)).to.be.true
    })
  })

  describe('handleSync', () => {
    it('should call skillExportStackFactory with resolved project path', async () => {
      const {factory} = makeSkillExportStack()
      await callSyncHandler('client-1', factory)
      expect(factory.calledOnceWith('/test/project')).to.be.true
    })

    it('should call coordinator.buildAndSync() and return the block', async () => {
      const {factory, stack} = makeSkillExportStack({buildResult: 'my knowledge'})
      const result = await callSyncHandler('client-1', factory)
      expect((stack.coordinator.buildAndSync as sinon.SinonStub).calledOnce).to.be.true
      expect(result.block).to.equal('my knowledge')
    })

    it('should return the coordinator result unchanged', async () => {
      const {factory, stack} = makeSkillExportStack({buildResult: 'the block'})
      await callSyncHandler('client-1', factory)
      expect((stack.coordinator.buildAndSync as sinon.SinonStub).calledOnce).to.be.true
    })

    it('should return block merged with sync result', async () => {
      const updated = [{agent: 'Claude Code', path: '/p/SKILL.md', scope: 'project'}]
      const failed = [{agent: 'Cursor', error: 'disk full', scope: 'project'}]
      const {factory} = makeSkillExportStack({
        buildResult: 'kb',
        syncResult: {failed, updated},
      })

      const result = await callSyncHandler('client-1', factory)

      expect(result.block).to.equal('kb')
      expect(result.updated).to.deep.equal(updated)
      expect(result.failed).to.deep.equal(failed)
    })

    it('should work with empty block (post-reset cleanup path)', async () => {
      const {factory} = makeSkillExportStack({
        buildResult: '',
        syncResult: {failed: [], updated: [{agent: 'Claude Code', path: '/p', scope: 'project'}]},
      })

      const result = await callSyncHandler('client-1', factory)

      expect(result.block).to.equal('')
      expect(result.updated).to.have.lengthOf(1)
    })

    it('should resolve project path from clientId', async () => {
      const {factory} = makeSkillExportStack()
      await callSyncHandler('client-42', factory)
      expect(resolveProjectPath.calledWith('client-42')).to.be.true
    })

    it('should throw when project path is undefined', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      resolveProjectPath.returns(undefined)
      const {factory} = makeSkillExportStack()

      try {
        await callSyncHandler('client-1', factory)
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('No project path found for client')
      }

      expect(factory.called).to.be.false
    })
  })
})
