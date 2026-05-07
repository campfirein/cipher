/**
 * Integration tests for MCP tool workspace resolution.
 *
 * Verifies that `resolveMcpTaskContext()` correctly resolves workspace links
 * per-call and that `associateProjectWithRetry()` sends the canonical
 * project path.
 *
 * Uses real filesystem (tmpdir) + real resolver. Transport client is stubbed.
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import {
  associateProjectWithRetry,
  resolveMcpTaskContext,
} from '../../../src/server/infra/mcp/tools/mcp-project-context.js'
import {BrokenWorktreePointerError} from '../../../src/server/infra/project/resolve-project.js'

// ============================================================================
// Helpers
// ============================================================================

function createBrvConfig(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function createWorkspaceLink(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, '.brv'), JSON.stringify({projectRoot}, null, 2) + '\n')
}

function makeStubTransportClient(sandbox: SinonSandbox): ITransportClient & {requestWithAck: SinonStub} {
  return {
    connect: sandbox.stub().resolves(),
    disconnect: sandbox.stub().resolves(),
    getClientId: sandbox.stub().returns('mcp-client-1'),
    getDaemonVersion: sandbox.stub(),
    getState: sandbox.stub().returns('connected'),
    isConnected: sandbox.stub().resolves(true),
    joinRoom: sandbox.stub().resolves(),
    leaveRoom: sandbox.stub().resolves(),
    on: sandbox.stub().returns(() => {}),
    once: sandbox.stub(),
    onStateChange: sandbox.stub().returns(() => {}),
    request: sandbox.stub() as unknown as ITransportClient['request'],
    requestWithAck: sandbox.stub().resolves(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MCP tool workspace resolution (integration)', () => {
  let sandbox: SinonSandbox
  let testDir: string

  beforeEach(() => {
    sandbox = createSandbox()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-mcp-integ-')))
  })

  afterEach(() => {
    sandbox.restore()
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('resolveMcpTaskContext', () => {
    it('should resolve linked workspace from cwd', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createWorkspaceLink(workspace, projectRoot)

      const result = resolveMcpTaskContext(workspace)
      expect(result.projectRoot).to.equal(projectRoot)
      expect(result.worktreeRoot).to.equal(workspace)
    })

    it('should resolve direct project from cwd', () => {
      const projectRoot = join(testDir, 'project')
      mkdirSync(projectRoot, {recursive: true})
      createBrvConfig(projectRoot)

      const result = resolveMcpTaskContext(projectRoot)
      expect(result.projectRoot).to.equal(projectRoot)
      expect(result.worktreeRoot).to.equal(projectRoot)
    })

    it('should resolve fresh per call — picks up link creation', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)

      // Before link: walked-up
      const before = resolveMcpTaskContext(workspace)
      expect(before.worktreeRoot).to.equal(projectRoot) // walked-up: worktreeRoot === projectRoot

      // Create link
      createWorkspaceLink(workspace, projectRoot)

      // After link: linked
      const after = resolveMcpTaskContext(workspace)
      expect(after.worktreeRoot).to.equal(workspace) // linked: worktreeRoot === workspace
    })

    it('should resolve fresh per call — picks up link deletion', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createWorkspaceLink(workspace, projectRoot)

      // Before unlink: linked
      const before = resolveMcpTaskContext(workspace)
      expect(before.worktreeRoot).to.equal(workspace)

      // Remove link
      unlinkSync(join(workspace, '.brv'))

      // After unlink: reverts to walked-up
      const after = resolveMcpTaskContext(workspace)
      expect(after.worktreeRoot).to.equal(projectRoot)
    })

    it('should throw on broken workspace link', () => {
      const workspace = join(testDir, 'workspace')
      mkdirSync(workspace, {recursive: true})
      createWorkspaceLink(workspace, '/nonexistent/project')

      expect(() => resolveMcpTaskContext(workspace)).to.throw(BrokenWorktreePointerError)
    })

    it('should fall back to startup context when resolver returns null', () => {
      const emptyDir = join(testDir, 'empty')
      mkdirSync(emptyDir, {recursive: true})

      const startupContext = {
        projectRoot: '/startup/project',
        worktreeRoot: emptyDir,
      }

      const result = resolveMcpTaskContext(emptyDir, startupContext)
      expect(result.projectRoot).to.equal('/startup/project')
      expect(result.worktreeRoot).to.equal(emptyDir)
    })

    it('should throw when resolver returns null and no startup context', () => {
      const emptyDir = join(testDir, 'empty')
      mkdirSync(emptyDir, {recursive: true})

      expect(() => resolveMcpTaskContext(emptyDir)).to.throw('No ByteRover project could be resolved')
    })

    it('should prefer fresh resolution over startup context', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(projectRoot, 'packages', 'api')
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createWorkspaceLink(workspace, projectRoot)

      const staleStartup = {
        projectRoot: '/stale/project',
        worktreeRoot: workspace,
      }

      // Fresh resolution should win over startup context
      const result = resolveMcpTaskContext(workspace, staleStartup)
      expect(result.projectRoot).to.equal(projectRoot) // from fresh resolver, not stale startup
      expect(result.worktreeRoot).to.equal(workspace)
    })
  })

  describe('associateProjectWithRetry', () => {
    it('should send canonical projectRoot via ASSOCIATE_PROJECT', async () => {
      const client = makeStubTransportClient(sandbox)

      await associateProjectWithRetry(client, '/canonical/project/path')

      expect(client.requestWithAck.calledOnce).to.be.true
      const [event, payload] = client.requestWithAck.firstCall.args
      expect(event).to.equal('client:associateProject')
      expect(payload).to.deep.equal({projectPath: '/canonical/project/path'})
    })

    it('should retry on first failure then succeed', async () => {
      const client = makeStubTransportClient(sandbox)
      client.requestWithAck
        .onFirstCall().rejects(new Error('connection lost'))
        .onSecondCall().resolves()

      await associateProjectWithRetry(client, '/project')

      expect(client.requestWithAck.callCount).to.equal(2)
    })

    it('should throw after max retry attempts exhausted', async () => {
      const client = makeStubTransportClient(sandbox)
      client.requestWithAck.rejects(new Error('daemon unreachable'))

      try {
        await associateProjectWithRetry(client, '/project')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to associate MCP client')
        expect((error as Error).message).to.include('/project')
      }

      // Should have tried MCP_ASSOCIATE_PROJECT_MAX_ATTEMPTS times (2)
      expect(client.requestWithAck.callCount).to.equal(2)
    })
  })
})
