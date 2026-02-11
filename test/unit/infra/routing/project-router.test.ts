/**
 * ProjectRouter Unit Tests
 *
 * Tests the project-scoped event routing that wraps ITransportServer
 * room methods with project-specific room naming.
 *
 * Key scenarios:
 * - Room name convention: project:<sanitizedPath>:broadcast
 * - Delegation to ITransportServer room methods
 * - Member tracking and cleanup
 * - Project isolation (project-a vs project-b)
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITransportServer} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {ProjectRouter} from '../../../../src/server/infra/routing/project-router.js'

describe('ProjectRouter', () => {
  let sandbox: SinonSandbox
  let mockTransport: ITransportServer
  let router: ProjectRouter

  // Keep stub references to avoid `as SinonStub` assertions
  let addToRoomStub: SinonStub
  let broadcastToStub: SinonStub
  let removeFromRoomStub: SinonStub

  const PROJECT_A_SANITIZED = 'Users--john--app-a'
  const PROJECT_B_SANITIZED = 'Users--john--app-b'
  const PROJECT_A_ROOM = `project:${PROJECT_A_SANITIZED}:broadcast`
  const PROJECT_B_ROOM = `project:${PROJECT_B_SANITIZED}:broadcast`

  beforeEach(() => {
    sandbox = createSandbox()

    addToRoomStub = sandbox.stub()
    broadcastToStub = sandbox.stub()
    removeFromRoomStub = sandbox.stub()

    mockTransport = {
      addToRoom: addToRoomStub,
      broadcast: sandbox.stub(),
      broadcastTo: broadcastToStub,
      getPort: sandbox.stub().returns(3000),
      isRunning: sandbox.stub().returns(true),
      onConnection: sandbox.stub(),
      onDisconnection: sandbox.stub(),
      onRequest: sandbox.stub(),
      removeFromRoom: removeFromRoomStub,
      sendTo: sandbox.stub(),
      start: sandbox.stub().resolves(),
      stop: sandbox.stub().resolves(),
    }

    router = new ProjectRouter({transport: mockTransport})
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('addToProjectRoom()', () => {
    it('should delegate to transport.addToRoom with correct room name', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)

      expect(addToRoomStub.calledOnce).to.be.true
      expect(addToRoomStub.calledWith('client-1', PROJECT_A_ROOM)).to.be.true
    })

    it('should track the client in room members', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)

      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal(['client-1'])
    })

    it('should handle adding multiple clients to the same room', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_A_SANITIZED)

      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.have.lengthOf(2)
      expect(members).to.include('client-1')
      expect(members).to.include('client-2')
    })

    it('should be idempotent — adding same client twice is safe', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)

      // transport.addToRoom called twice (Socket.IO join is idempotent)
      expect(addToRoomStub.calledTwice).to.be.true

      // But internal member tracking uses Set, so only one entry
      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal(['client-1'])
    })
  })

  describe('removeFromProjectRoom()', () => {
    it('should delegate to transport.removeFromRoom with correct room name', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.removeFromProjectRoom('client-1', PROJECT_A_SANITIZED)

      expect(removeFromRoomStub.calledOnce).to.be.true
      expect(removeFromRoomStub.calledWith('client-1', PROJECT_A_ROOM)).to.be.true
    })

    it('should remove the client from room members', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_A_SANITIZED)

      router.removeFromProjectRoom('client-1', PROJECT_A_SANITIZED)

      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal(['client-2'])
    })

    it('should clean up empty room entry from map', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.removeFromProjectRoom('client-1', PROJECT_A_SANITIZED)

      // Room should be cleaned up — getProjectMembers returns empty array
      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal([])
    })

    it('should be a no-op for non-existent client', () => {
      // No clients added, removing should not throw
      router.removeFromProjectRoom('client-unknown', PROJECT_A_SANITIZED)

      expect(removeFromRoomStub.calledOnce).to.be.true
      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal([])
    })
  })

  describe('broadcastToProject()', () => {
    it('should delegate to transport.broadcastTo with correct room name', () => {
      const payload = {key: 'value'}
      router.broadcastToProject(PROJECT_A_SANITIZED, 'config:updated', payload)

      expect(broadcastToStub.calledOnce).to.be.true
      expect(broadcastToStub.calledWith(PROJECT_A_ROOM, 'config:updated', payload)).to.be.true
    })

    it('should use the correct room for different projects', () => {
      router.broadcastToProject(PROJECT_A_SANITIZED, 'event-a', {a: 1})
      router.broadcastToProject(PROJECT_B_SANITIZED, 'event-b', {b: 2})

      expect(broadcastToStub.calledTwice).to.be.true
      expect(broadcastToStub.calledWith(PROJECT_A_ROOM, 'event-a', {a: 1})).to.be.true
      expect(broadcastToStub.calledWith(PROJECT_B_ROOM, 'event-b', {b: 2})).to.be.true
    })
  })

  describe('getProjectMembers()', () => {
    it('should return empty array for unknown project', () => {
      const members = router.getProjectMembers('unknown--project')
      expect(members).to.deep.equal([])
    })

    it('should return members after addToProjectRoom', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_A_SANITIZED)

      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.have.lengthOf(2)
      expect(members).to.include('client-1')
      expect(members).to.include('client-2')
    })

    it('should reflect removal after removeFromProjectRoom', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_A_SANITIZED)

      router.removeFromProjectRoom('client-1', PROJECT_A_SANITIZED)

      const members = router.getProjectMembers(PROJECT_A_SANITIZED)
      expect(members).to.deep.equal(['client-2'])
    })

    it('should return a new array each call (not a reference to internal state)', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)

      const members1 = router.getProjectMembers(PROJECT_A_SANITIZED)
      const members2 = router.getProjectMembers(PROJECT_A_SANITIZED)

      expect(members1).to.deep.equal(members2)
      expect(members1).to.not.equal(members2) // Different array instances
    })
  })

  describe('Room Naming', () => {
    it('should follow convention: project:<sanitizedPath>:broadcast', () => {
      router.addToProjectRoom('client-1', 'Users--john--my-app')

      expect(addToRoomStub.calledWith('client-1', 'project:Users--john--my-app:broadcast')).to.be.true
    })

    it('should produce different room names for different sanitized paths', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_B_SANITIZED)

      const call1 = addToRoomStub.getCall(0)
      const call2 = addToRoomStub.getCall(1)

      expect(call1.args[1]).to.not.equal(call2.args[1])
      expect(call1.args[1]).to.equal(PROJECT_A_ROOM)
      expect(call2.args[1]).to.equal(PROJECT_B_ROOM)
    })
  })

  describe('Project Isolation', () => {
    it('should not show project-a clients in project-b members', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-2', PROJECT_B_SANITIZED)

      const membersA = router.getProjectMembers(PROJECT_A_SANITIZED)
      const membersB = router.getProjectMembers(PROJECT_B_SANITIZED)

      expect(membersA).to.deep.equal(['client-1'])
      expect(membersB).to.deep.equal(['client-2'])
    })

    it('should allow same client in multiple project rooms', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-1', PROJECT_B_SANITIZED)

      const membersA = router.getProjectMembers(PROJECT_A_SANITIZED)
      const membersB = router.getProjectMembers(PROJECT_B_SANITIZED)

      expect(membersA).to.deep.equal(['client-1'])
      expect(membersB).to.deep.equal(['client-1'])
    })

    it('should remove client from only the specified project room', () => {
      router.addToProjectRoom('client-1', PROJECT_A_SANITIZED)
      router.addToProjectRoom('client-1', PROJECT_B_SANITIZED)

      router.removeFromProjectRoom('client-1', PROJECT_A_SANITIZED)

      expect(router.getProjectMembers(PROJECT_A_SANITIZED)).to.deep.equal([])
      expect(router.getProjectMembers(PROJECT_B_SANITIZED)).to.deep.equal(['client-1'])
    })

    it('should broadcast to project-a room without affecting project-b', () => {
      const payload = {config: 'updated'}
      router.broadcastToProject(PROJECT_A_SANITIZED, 'config:updated', payload)

      expect(broadcastToStub.calledOnce).to.be.true
      expect(broadcastToStub.calledWith(PROJECT_A_ROOM, 'config:updated', payload)).to.be.true
      // project-b room was never mentioned
    })
  })
})
