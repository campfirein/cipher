/* eslint-disable max-nested-callbacks */
/**
 * ProjectStateLoader Unit Tests
 *
 * Tests per-project state loading with promise deduplication.
 *
 * Key scenarios:
 * - Config loading from IProjectConfigStore
 * - Session loading from XDG sessions dir
 * - Caching (subsequent calls return cached result)
 * - Promise dedup (concurrent calls -> 1 load)
 * - Invalidation (clears cache, forces reload)
 * - Error isolation (config error -> partial success, not crash)
 * - Project isolation (loading A doesn't affect B)
 */

import {expect} from 'chai'
import {mkdirSync, writeFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IProjectRegistry} from '../../../../src/server/core/interfaces/project/i-project-registry.js'
import type {IProjectConfigStore} from '../../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {BrvConfig} from '../../../../src/server/core/domain/entities/brv-config.js'
import {ProjectInfo} from '../../../../src/server/core/domain/project/project-info.js'
import {ProjectStateLoader} from '../../../../src/server/infra/state/project-state-loader.js'

const PROJECT_A = '/Users/john/app-a'
const PROJECT_B = '/Users/john/app-b'

function createTestConfig(): BrvConfig {
  return new BrvConfig({
    chatLogPath: '/tmp/chat.log',
    createdAt: new Date().toISOString(),
    cwd: PROJECT_A,
    ide: 'Claude Code',
    spaceId: 'space-1',
    spaceName: 'Test Space',
    teamId: 'team-1',
    teamName: 'Test Team',
    version: '0.0.1',
  })
}

function createProjectInfo(projectPath: string, storagePath: string): ProjectInfo {
  return new ProjectInfo({
    projectPath,
    registeredAt: Date.now(),
    sanitizedPath: 'Users--john--app-a',
    storagePath,
  })
}

function createSessionFile(sessionsDir: string, sessionId: string): void {
  mkdirSync(sessionsDir, {recursive: true})
  const filename = `session-2025-01-01T00-00-00-${sessionId}.json`
  const metadata = {
    createdAt: '2025-01-01T00:00:00.000Z',
    lastUpdated: '2025-01-01T01:00:00.000Z',
    messageCount: 5,
    sessionId: `agent-session-${sessionId}`,
    status: 'ended',
    title: `Test Session ${sessionId}`,
    workingDirectory: PROJECT_A,
  }
  writeFileSync(join(sessionsDir, filename), JSON.stringify(metadata))
}

describe('ProjectStateLoader', () => {
  let sandbox: SinonSandbox
  let configStore: IProjectConfigStore
  let configReadStub: SinonStub
  let projectRegistry: IProjectRegistry
  let registryGetStub: SinonStub
  let loader: ProjectStateLoader
  let tempDir: string

  beforeEach(async () => {
    sandbox = createSandbox()

    // Create temp dir for XDG storage
    tempDir = await fs.mkdtemp(join(tmpdir(), 'brv-state-test-'))

    // Stub IProjectConfigStore
    configReadStub = sandbox.stub()
    configStore = {
      exists: sandbox.stub().resolves(true),
      getModifiedTime: sandbox.stub().resolves(),
      read: configReadStub,
      write: sandbox.stub().resolves(),
    }

    // Stub IProjectRegistry
    registryGetStub = sandbox.stub()
    projectRegistry = {
      get: registryGetStub,
      getAll: sandbox.stub().returns(new Map()),
      register: sandbox.stub(),
      unregister: sandbox.stub(),
    } as unknown as IProjectRegistry

    loader = new ProjectStateLoader({
      configStore,
      projectRegistry,
    })
  })

  afterEach(async () => {
    sandbox.restore()
    await fs.rm(tempDir, {force: true, recursive: true}).catch(() => {})
  })

  describe('getProjectState()', () => {
    it('should load config and sessions on first call', async () => {
      const config = createTestConfig()
      configReadStub.resolves(config)

      const storagePath = join(tempDir, 'project-a')
      const sessionsDir = join(storagePath, 'sessions')
      mkdirSync(sessionsDir, {recursive: true})
      registryGetStub.returns(createProjectInfo(PROJECT_A, storagePath))

      const result = await loader.getProjectState(PROJECT_A)

      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.config).to.equal(config)
        expect(result.state.sessions).to.be.an('array')
        expect(result.state.loadedAt).to.be.a('number')
      }

      expect(configReadStub.calledOnce).to.be.true
    })

    it('should return cached result on subsequent calls', async () => {
      const config = createTestConfig()
      configReadStub.resolves(config)
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      const result1 = await loader.getProjectState(PROJECT_A)
      const result2 = await loader.getProjectState(PROJECT_A)

      expect(result1).to.equal(result2) // Same reference
      expect(configReadStub.calledOnce).to.be.true // Only 1 disk read
    })

    it('should load sessions from XDG sessions dir', async () => {
      configReadStub.resolves()

      const storagePath = join(tempDir, 'project-a')
      const sessionsDir = join(storagePath, 'sessions')
      createSessionFile(sessionsDir, 'abc12345')
      registryGetStub.returns(createProjectInfo(PROJECT_A, storagePath))

      const result = await loader.getProjectState(PROJECT_A)

      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.sessions).to.have.lengthOf(1)
        expect(result.state.sessions[0].sessionId).to.equal('agent-session-abc12345')
      }
    })

    it('should return sessions:[] when project not registered', async () => {
      configReadStub.resolves()
      registryGetStub.returns(undefined) // eslint-disable-line unicorn/no-useless-undefined

      const result = await loader.getProjectState(PROJECT_A)

      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.sessions).to.deep.equal([])
      }
    })

    it('should return config:undefined when config not found', async () => {
      configReadStub.resolves()
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      const result = await loader.getProjectState(PROJECT_A)

      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.config).to.be.undefined
      }
    })

    it('should return config:undefined on config read error (partial success)', async () => {
      configReadStub.rejects(new Error('Invalid config'))
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      const result = await loader.getProjectState(PROJECT_A)

      // Should still succeed (partial) — sessions load succeeds
      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.config).to.be.undefined
        expect(result.state.sessions).to.be.an('array')
      }
    })

    it('should return sessions:[] on session read error (partial success)', async () => {
      configReadStub.resolves(createTestConfig())
      // Return a projectInfo that points to an inaccessible path
      registryGetStub.returns(createProjectInfo(PROJECT_A, '/nonexistent/path/that/triggers/error'))

      const result = await loader.getProjectState(PROJECT_A)

      expect(result.ok).to.be.true
      if (result.ok) {
        expect(result.state.config).to.not.be.undefined
        // Sessions either empty (dir auto-created) or error-caught
        expect(result.state.sessions).to.be.an('array')
      }
    })
  })

  describe('promise dedup', () => {
    it('should share one load across 10 concurrent calls', async () => {
      // Make config load async to ensure concurrency
      configReadStub.callsFake(
        () =>
          new Promise<BrvConfig | undefined>((resolve) => {
            setTimeout(() => resolve(createTestConfig()), 10)
          }),
      )
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      // Fire 10 concurrent calls
      const promises = Array.from({length: 10}, () => loader.getProjectState(PROJECT_A))
      const results = await Promise.all(promises)

      // All results should be the same reference
      for (const result of results) {
        expect(result).to.equal(results[0])
      }

      // configStore.read() should only have been called once
      expect(configReadStub.calledOnce).to.be.true
    })
  })

  describe('invalidate()', () => {
    it('should cause next call to reload from disk', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      await loader.getProjectState(PROJECT_A)
      expect(configReadStub.calledOnce).to.be.true

      loader.invalidate(PROJECT_A)

      await loader.getProjectState(PROJECT_A)
      expect(configReadStub.calledTwice).to.be.true
    })

    it('should be a no-op for unknown project', () => {
      // Should not throw
      loader.invalidate('/unknown/project')
    })
  })

  describe('invalidateAll()', () => {
    it('should clear all cached states', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub
        .withArgs(PROJECT_A)
        .returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))
        .withArgs(PROJECT_B)
        .returns(createProjectInfo(PROJECT_B, join(tempDir, 'b')))

      await loader.getProjectState(PROJECT_A)
      await loader.getProjectState(PROJECT_B)
      expect(configReadStub.calledTwice).to.be.true

      loader.invalidateAll()

      await loader.getProjectState(PROJECT_A)
      await loader.getProjectState(PROJECT_B)
      expect(configReadStub.callCount).to.equal(4) // 2 original + 2 after invalidateAll
    })
  })

  describe('getProjectConfig()', () => {
    it('should return BrvConfig from loaded state', async () => {
      const config = createTestConfig()
      configReadStub.resolves(config)
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      const result = await loader.getProjectConfig(PROJECT_A)

      expect(result).to.equal(config)
    })

    it('should return undefined when no config exists', async () => {
      configReadStub.resolves()
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'project-a')))

      const result = await loader.getProjectConfig(PROJECT_A)

      expect(result).to.be.undefined
    })
  })

  describe('getProjectSessions()', () => {
    it('should return session list from loaded state', async () => {
      configReadStub.resolves()

      const storagePath = join(tempDir, 'project-a')
      const sessionsDir = join(storagePath, 'sessions')
      createSessionFile(sessionsDir, 'abc12345')
      createSessionFile(sessionsDir, 'def67890')
      registryGetStub.returns(createProjectInfo(PROJECT_A, storagePath))

      const result = await loader.getProjectSessions(PROJECT_A)

      expect(result).to.have.lengthOf(2)
    })

    it('should return empty array when project not registered', async () => {
      configReadStub.resolves()
      registryGetStub.returns(undefined) // eslint-disable-line unicorn/no-useless-undefined

      const result = await loader.getProjectSessions(PROJECT_A)

      expect(result).to.deep.equal([])
    })
  })

  describe('project isolation', () => {
    it('should load projects independently', async () => {
      const configA = createTestConfig()
      const configB = new BrvConfig({
        chatLogPath: '/tmp/chat-b.log',
        createdAt: new Date().toISOString(),
        cwd: PROJECT_B,
        ide: 'Cursor',
        spaceId: 'space-2',
        spaceName: 'Space B',
        teamId: 'team-2',
        teamName: 'Team B',
        version: '0.0.1',
      })

      configReadStub.withArgs(PROJECT_A).resolves(configA).withArgs(PROJECT_B).resolves(configB)
      registryGetStub
        .withArgs(PROJECT_A)
        .returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))
        .withArgs(PROJECT_B)
        .returns(createProjectInfo(PROJECT_B, join(tempDir, 'b')))

      const resultA = await loader.getProjectState(PROJECT_A)
      const resultB = await loader.getProjectState(PROJECT_B)

      expect(resultA.ok).to.be.true
      expect(resultB.ok).to.be.true
      if (resultA.ok && resultB.ok) {
        expect(resultA.state.config).to.equal(configA)
        expect(resultB.state.config).to.equal(configB)
      }
    })

    it('should not affect project-b when invalidating project-a', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub
        .withArgs(PROJECT_A)
        .returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))
        .withArgs(PROJECT_B)
        .returns(createProjectInfo(PROJECT_B, join(tempDir, 'b')))

      await loader.getProjectState(PROJECT_A)
      await loader.getProjectState(PROJECT_B)

      loader.invalidate(PROJECT_A)

      // Project-B should still be cached (no re-read needed)
      const beforeCount = configReadStub.callCount
      await loader.getProjectState(PROJECT_B)
      expect(configReadStub.callCount).to.equal(beforeCount) // No new read
    })
  })

  describe('shouldInvalidate()', () => {
    it('should return false when no cached state exists', async () => {
      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.false
    })

    it('should return false when config file does not exist', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))
      ;(configStore.getModifiedTime as SinonStub).resolves()

      await loader.getProjectState(PROJECT_A)

      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.false
    })

    it('should return false when file modification time equals cache time', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))

      const loadTime = Date.now()
      const clockStub = sandbox.stub(Date, 'now').returns(loadTime)

      await loader.getProjectState(PROJECT_A)

      // File modified at same time as load
      ;(configStore.getModifiedTime as SinonStub).resolves(loadTime)

      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.false

      clockStub.restore()
    })

    it('should return false when file modification time is before cache time', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))

      const loadTime = Date.now()
      const clockStub = sandbox.stub(Date, 'now').returns(loadTime)

      await loader.getProjectState(PROJECT_A)

      // File modified before load
      ;(configStore.getModifiedTime as SinonStub).resolves(loadTime - 1000)

      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.false

      clockStub.restore()
    })

    it('should return true when file modification time is after cache time', async () => {
      configReadStub.resolves(createTestConfig())
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))

      const loadTime = Date.now()
      const clockStub = sandbox.stub(Date, 'now').returns(loadTime)

      await loader.getProjectState(PROJECT_A)

      // File modified after load (simulating init/space-switch write)
      ;(configStore.getModifiedTime as SinonStub).resolves(loadTime + 1000)

      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.true

      clockStub.restore()
    })

    it('should return false when cached state has error', async () => {
      configReadStub.rejects(new Error('Config read error'))
      registryGetStub.returns(createProjectInfo(PROJECT_A, join(tempDir, 'a')))

      await loader.getProjectState(PROJECT_A)

      const result = await loader.shouldInvalidate(PROJECT_A)
      expect(result).to.be.false
    })
  })
})
