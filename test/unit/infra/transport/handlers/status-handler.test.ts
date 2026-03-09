/**
 * StatusHandler tests
 *
 * Verifies that `currentDirectory` in the StatusDTO preserves the actual
 * client working directory (backward compatibility) rather than the resolved
 * project root.
 */

import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {StatusHandler} from '../../../../../src/server/infra/transport/handlers/status-handler.js'
import {StatusEvents} from '../../../../../src/shared/transport/events/status-events.js'

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

describe('StatusHandler', () => {
  let testDir: string
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-status-handler-')))
    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
    rmSync(testDir, {force: true, recursive: true})
  })

  function createHandler(projectPath?: string): void {
    const handler = new StatusHandler({
      contextTreeService: {
        delete: stub(),
        exists: stub().resolves(false),
        initialize: stub().resolves(''),
      } as unknown as IContextTreeService,
      contextTreeSnapshotService: {
        getChanges: stub(),
        getCurrentState: stub(),
        getSnapshotState: stub(),
        hasSnapshot: stub(),
        initEmptySnapshot: stub(),
        saveSnapshot: stub(),
        saveSnapshotFromState: stub(),
      } as unknown as IContextTreeSnapshotService,
      projectConfigStore: {
        exists: stub().resolves(false),
        getModifiedTime: stub().resolves(Date.now()),
        read: stub().resolves(),
        write: stub().resolves(),
      } as unknown as SinonStubbedInstance<IProjectConfigStore>,
      resolveProjectPath: stub().returns(projectPath ?? testDir),
      tokenStore: {
        clear: stub().resolves(),
        load: stub().resolves(),
        save: stub().resolves(),
      } as unknown as ITokenStore,
      transport,
    })
    handler.setup()
  }

  async function callGetHandler(data?: {cwd?: string}, clientId = 'client-1'): Promise<{status: StatusDTO}> {
    const handler = transport._handlers.get(StatusEvents.GET)
    expect(handler, 'status:get handler should be registered').to.exist
    return handler!(data, clientId) as Promise<{status: StatusDTO}>
  }

  describe('currentDirectory', () => {
    it('should equal projectPath when no cwd is provided', async () => {
      createHandler('/test/project')

      const {status} = await callGetHandler()

      expect(status.currentDirectory).to.equal('/test/project')
    })

    it('should equal clientCwd when cwd is provided', async () => {
      // Create a real project so resolveProject() succeeds
      const projectRoot = join(testDir, 'project')
      const subDir = join(projectRoot, 'packages', 'api', 'src')
      mkdirSync(join(projectRoot, '.brv'), {recursive: true})
      writeFileSync(join(projectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
      mkdirSync(subDir, {recursive: true})

      createHandler(projectRoot)

      const {status} = await callGetHandler({cwd: subDir})

      expect(status.currentDirectory).to.equal(subDir)
      expect(status.projectRoot).to.equal(projectRoot)
    })

    it('should preserve clientCwd even when resolver returns null', async () => {
      // Pass a cwd that has no .brv/ — resolveProject returns null
      const noProjectDir = join(testDir, 'no-project')
      mkdirSync(noProjectDir, {recursive: true})

      createHandler('/fallback/project')

      const {status} = await callGetHandler({cwd: noProjectDir})

      expect(status.currentDirectory).to.equal(noProjectDir)
    })
  })
})
