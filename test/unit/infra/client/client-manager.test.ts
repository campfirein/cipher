/**
 * ClientManager Unit Tests
 *
 * Tests client lifecycle tracking and project membership.
 *
 * Key scenarios:
 * - Client registration with and without projectPath
 * - Client unregistration and cleanup
 * - Global-scope MCP association via associateProject
 * - onProjectEmpty callback firing rules
 * - Project isolation (independent tracking per project)
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import {ClientManager} from '../../../../src/server/infra/client/client-manager.js'

describe('ClientManager', () => {
  let sandbox: SinonSandbox
  let manager: ClientManager

  const PROJECT_A = '/Users/john/app-a'
  const PROJECT_B = '/Users/john/app-b'

  beforeEach(() => {
    sandbox = createSandbox()
    manager = new ClientManager()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('register()', () => {
    it('should register a client with projectPath', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      const client = manager.getClient('client-1')
      expect(client).to.not.be.undefined
      expect(client!.id).to.equal('client-1')
      expect(client!.type).to.equal('tui')
      expect(client!.projectPath).to.equal(PROJECT_A)
    })

    it('should register a client without projectPath (global-scope MCP)', () => {
      manager.register('client-1', 'mcp')

      const client = manager.getClient('client-1')
      expect(client).to.not.be.undefined
      expect(client!.type).to.equal('mcp')
      expect(client!.projectPath).to.be.undefined
    })

    it('should overwrite when registering same clientId twice', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-1', 'mcp', PROJECT_B)

      const client = manager.getClient('client-1')
      expect(client!.type).to.equal('mcp')
      expect(client!.projectPath).to.equal(PROJECT_B)
    })

    it('should cleanup old project index when overwriting with different project', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(1)

      manager.register('client-1', 'tui', PROJECT_B)

      // Old project index should be cleaned up
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(0)
      // New project index should have the client
      expect(manager.getClientsByProject(PROJECT_B)).to.have.lengthOf(1)
      expect(manager.getClientsByProject(PROJECT_B)[0].id).to.equal('client-1')
    })

    it('should cleanup old project index when overwriting with no project', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(1)

      manager.register('client-1', 'mcp') // no projectPath

      // Old project index should be cleaned up
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(0)
      expect(manager.getActiveProjects()).to.not.include(PROJECT_A)
    })

    it('should add client to project index when projectPath provided', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      const clients = manager.getClientsByProject(PROJECT_A)
      expect(clients).to.have.lengthOf(1)
      expect(clients[0].id).to.equal('client-1')
    })

    it('should not add client to any project index when projectPath absent', () => {
      manager.register('client-1', 'mcp')

      const projects = manager.getActiveProjects()
      expect(projects).to.have.lengthOf(0)
    })

    it('should fire clientConnectedCallback only once for re-registration of same clientId', () => {
      const connectedCallback = sandbox.stub()
      manager.onClientConnected(connectedCallback)

      manager.register('client-1', 'tui', PROJECT_A)
      expect(connectedCallback.callCount).to.equal(1)

      // Re-register same clientId — should NOT fire again
      manager.register('client-1', 'mcp', PROJECT_B)
      expect(connectedCallback.callCount).to.equal(1)
    })

    it('should keep clientCount in sync after re-registration and unregister', () => {
      const connectedCallback = sandbox.stub()
      const disconnectedCallback = sandbox.stub()
      manager.onClientConnected(connectedCallback)
      manager.onClientDisconnected(disconnectedCallback)

      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-1', 'mcp', PROJECT_B) // re-register

      // Only 1 connected callback (not 2)
      expect(connectedCallback.callCount).to.equal(1)

      manager.unregister('client-1')

      // 1 disconnected callback — balanced with 1 connected
      expect(disconnectedCallback.callCount).to.equal(1)
    })
  })

  describe('unregister()', () => {
    it('should remove client from tracking', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.unregister('client-1')

      expect(manager.getClient('client-1')).to.be.undefined
    })

    it('should remove client from project index', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_A)
      manager.unregister('client-1')

      const clients = manager.getClientsByProject(PROJECT_A)
      expect(clients).to.have.lengthOf(1)
      expect(clients[0].id).to.equal('client-2')
    })

    it('should be a no-op for unknown clientId', () => {
      // Should not throw
      manager.unregister('unknown-client')
    })

    it('should clean up empty project entry from index', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.unregister('client-1')

      const projects = manager.getActiveProjects()
      expect(projects).to.not.include(PROJECT_A)
    })
  })

  describe('associateProject()', () => {
    it('should bind global-scope client to project', () => {
      manager.register('client-1', 'mcp')

      manager.associateProject('client-1', PROJECT_A)

      const client = manager.getClient('client-1')
      expect(client!.projectPath).to.equal(PROJECT_A)
    })

    it('should make client appear in getClientsByProject after association', () => {
      manager.register('client-1', 'mcp')

      // Before association: not in any project
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(0)

      manager.associateProject('client-1', PROJECT_A)

      // After association: appears in project
      const clients = manager.getClientsByProject(PROJECT_A)
      expect(clients).to.have.lengthOf(1)
      expect(clients[0].id).to.equal('client-1')
    })

    it('should be a no-op for unknown clientId', () => {
      // Should not throw
      manager.associateProject('unknown', PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(0)
    })

    it('should be a no-op if client already has a project', () => {
      manager.register('client-1', 'mcp', PROJECT_A)

      manager.associateProject('client-1', PROJECT_B)

      // Should still be associated with original project
      const client = manager.getClient('client-1')
      expect(client!.projectPath).to.equal(PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_B)).to.have.lengthOf(0)
    })
  })

  describe('getClientsByProject()', () => {
    it('should return only clients for the specified project', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_B)
      manager.register('client-3', 'mcp', PROJECT_A)

      const clientsA = manager.getClientsByProject(PROJECT_A)
      expect(clientsA).to.have.lengthOf(2)

      const ids = clientsA.map((c) => c.id)
      expect(ids).to.include('client-1')
      expect(ids).to.include('client-3')
    })

    it('should return empty array for unknown project', () => {
      expect(manager.getClientsByProject('/unknown')).to.deep.equal([])
    })

    it('should include both external and agent clients', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('agent-1', 'agent', PROJECT_A)

      const clients = manager.getClientsByProject(PROJECT_A)
      expect(clients).to.have.lengthOf(2)

      const types = clients.map((c) => c.type)
      expect(types).to.include('tui')
      expect(types).to.include('agent')
    })

    it('should not include global-scope clients that are not yet associated', () => {
      manager.register('client-1', 'mcp') // no projectPath
      manager.register('client-2', 'tui', PROJECT_A)

      const clients = manager.getClientsByProject(PROJECT_A)
      expect(clients).to.have.lengthOf(1)
      expect(clients[0].id).to.equal('client-2')
    })
  })

  describe('getActiveProjects()', () => {
    it('should return all projects with at least one client', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_B)

      const projects = manager.getActiveProjects()
      expect(projects).to.have.lengthOf(2)
      expect(projects).to.include(PROJECT_A)
      expect(projects).to.include(PROJECT_B)
    })

    it('should return empty array when no projects', () => {
      expect(manager.getActiveProjects()).to.deep.equal([])
    })

    it('should remove project after all clients unregister', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_A)

      manager.unregister('client-1')
      expect(manager.getActiveProjects()).to.include(PROJECT_A)

      manager.unregister('client-2')
      expect(manager.getActiveProjects()).to.not.include(PROJECT_A)
    })
  })

  describe('getClient()', () => {
    it('should return client info for registered client', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      const client = manager.getClient('client-1')
      expect(client).to.not.be.undefined
      expect(client!.id).to.equal('client-1')
    })

    it('should return undefined for unknown client', () => {
      expect(manager.getClient('unknown')).to.be.undefined
    })
  })

  describe('onProjectEmpty()', () => {
    let emptyCallback: SinonStub

    beforeEach(() => {
      emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)
    })

    it('should fire callback when last external client disconnects', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      manager.unregister('client-1')

      expect(emptyCallback.calledOnce).to.be.true
      expect(emptyCallback.calledWith(PROJECT_A)).to.be.true
    })

    it('should NOT fire when agent client disconnects (agent is not external)', () => {
      manager.register('agent-1', 'agent', PROJECT_A)

      manager.unregister('agent-1')

      expect(emptyCallback.called).to.be.false
    })

    it('should NOT fire when project still has other external clients', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'mcp', PROJECT_A)

      manager.unregister('client-1')

      expect(emptyCallback.called).to.be.false
    })

    it('should fire immediately on unregister (no grace period)', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      manager.unregister('client-1')

      // Callback fired synchronously, not deferred
      expect(emptyCallback.calledOnce).to.be.true
    })

    it('should NOT fire for global-scope client that was never associated', () => {
      manager.register('client-1', 'mcp') // no projectPath

      manager.unregister('client-1')

      expect(emptyCallback.called).to.be.false
    })

    it('should fire when last mcp client disconnects, even if agent remains', () => {
      manager.register('client-1', 'mcp', PROJECT_A)
      manager.register('agent-1', 'agent', PROJECT_A)

      manager.unregister('client-1')

      // Agent doesn't count — project is "empty" from user perspective
      expect(emptyCallback.calledOnce).to.be.true
      expect(emptyCallback.calledWith(PROJECT_A)).to.be.true
    })

    it('should fire for each project independently', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_B)

      manager.unregister('client-1')
      expect(emptyCallback.calledOnce).to.be.true
      expect(emptyCallback.calledWith(PROJECT_A)).to.be.true

      manager.unregister('client-2')
      expect(emptyCallback.calledTwice).to.be.true
      expect(emptyCallback.secondCall.calledWith(PROJECT_B)).to.be.true
    })

    it('should not fire when no callback registered', () => {
      // Create a fresh manager without callback
      const noCallbackManager = new ClientManager()
      noCallbackManager.register('client-1', 'tui', PROJECT_A)

      // Should not throw
      noCallbackManager.unregister('client-1')
    })
  })

  describe('setAgentName()', () => {
    it('should set agent name on registered client', () => {
      manager.register('client-1', 'mcp', PROJECT_A)
      manager.setAgentName('client-1', 'Windsurf')

      const client = manager.getClient('client-1')
      expect(client!.agentName).to.equal('Windsurf')
    })

    it('should be a no-op for unknown clientId', () => {
      // Should not throw
      manager.setAgentName('unknown', 'Windsurf')
    })

    it('should allow overwriting agent name', () => {
      manager.register('client-1', 'mcp', PROJECT_A)
      manager.setAgentName('client-1', 'Windsurf')
      manager.setAgentName('client-1', 'Claude Code')

      const client = manager.getClient('client-1')
      expect(client!.agentName).to.equal('Claude Code')
    })

    it('should return undefined agentName by default', () => {
      manager.register('client-1', 'mcp', PROJECT_A)

      const client = manager.getClient('client-1')
      expect(client!.agentName).to.be.undefined
    })
  })

  describe('updateProjectPath()', () => {
    it('should move client from old project to new project index', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(1)

      const oldPath = manager.updateProjectPath('client-1', PROJECT_B)

      expect(oldPath).to.equal(PROJECT_A)
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(0)
      expect(manager.getClientsByProject(PROJECT_B)).to.have.lengthOf(1)
      expect(manager.getClientsByProject(PROJECT_B)[0].id).to.equal('client-1')
    })

    it('should update client projectPath property', () => {
      manager.register('client-1', 'tui', PROJECT_A)

      manager.updateProjectPath('client-1', PROJECT_B)

      const client = manager.getClient('client-1')
      expect(client!.projectPath).to.equal(PROJECT_B)
    })

    it('should fire onProjectEmpty when old project loses last external client', () => {
      const emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)

      manager.register('client-1', 'tui', PROJECT_A)

      manager.updateProjectPath('client-1', PROJECT_B)

      expect(emptyCallback.calledOnce).to.be.true
      expect(emptyCallback.calledWith(PROJECT_A)).to.be.true
    })

    it('should NOT fire onProjectEmpty when old project still has other external clients', () => {
      const emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)

      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_A)

      manager.updateProjectPath('client-1', PROJECT_B)

      expect(emptyCallback.called).to.be.false
    })

    it('should NOT fire onProjectEmpty when same path (idempotent)', () => {
      const emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)

      manager.register('client-1', 'tui', PROJECT_A)

      manager.updateProjectPath('client-1', PROJECT_A)

      expect(emptyCallback.called).to.be.false
    })

    it('should return undefined for unknown clientId', () => {
      const result = manager.updateProjectPath('unknown', PROJECT_A)
      expect(result).to.be.undefined
    })

    it('should return undefined when client had no previous project', () => {
      manager.register('client-1', 'mcp') // no projectPath

      const oldPath = manager.updateProjectPath('client-1', PROJECT_A)

      expect(oldPath).to.be.undefined
      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(1)
      expect(manager.getClient('client-1')!.projectPath).to.equal(PROJECT_A)
    })

    it('should NOT fire onProjectEmpty for agent clients (not external)', () => {
      const emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)

      manager.register('agent-1', 'agent', PROJECT_A)

      manager.updateProjectPath('agent-1', PROJECT_B)

      expect(emptyCallback.called).to.be.false
    })
  })

  describe('Project Isolation', () => {
    it('should track clients per project independently', () => {
      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_B)

      expect(manager.getClientsByProject(PROJECT_A)).to.have.lengthOf(1)
      expect(manager.getClientsByProject(PROJECT_B)).to.have.lengthOf(1)
      expect(manager.getClientsByProject(PROJECT_A)[0].id).to.equal('client-1')
      expect(manager.getClientsByProject(PROJECT_B)[0].id).to.equal('client-2')
    })

    it('should not affect project-b when project-a loses all clients', () => {
      const emptyCallback = sandbox.stub()
      manager.onProjectEmpty(emptyCallback)

      manager.register('client-1', 'tui', PROJECT_A)
      manager.register('client-2', 'tui', PROJECT_B)

      manager.unregister('client-1')

      // Only project-a callback fired
      expect(emptyCallback.calledOnce).to.be.true
      expect(emptyCallback.calledWith(PROJECT_A)).to.be.true

      // project-b still has its client
      expect(manager.getClientsByProject(PROJECT_B)).to.have.lengthOf(1)
    })
  })
})
