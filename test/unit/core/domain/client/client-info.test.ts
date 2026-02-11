/**
 * ClientInfo Unit Tests
 *
 * Tests the in-memory client entity used by ClientManager
 * for tracking connected clients and project membership.
 *
 * Key scenarios:
 * - Construction with and without projectPath
 * - Client type classification (external vs agent)
 * - Global-scope MCP association via associateProject()
 */

import {expect} from 'chai'

import {ClientInfo} from '../../../../../src/server/core/domain/client/client-info.js'

describe('ClientInfo', () => {
  describe('constructor', () => {
    it('should set all fields correctly', () => {
      const client = new ClientInfo({
        connectedAt: 1000,
        id: 'client-1',
        projectPath: '/app',
        type: 'tui',
      })

      expect(client.id).to.equal('client-1')
      expect(client.type).to.equal('tui')
      expect(client.connectedAt).to.equal(1000)
      expect(client.projectPath).to.equal('/app')
    })

    it('should leave projectPath undefined when not provided', () => {
      const client = new ClientInfo({
        connectedAt: 1000,
        id: 'client-1',
        type: 'mcp',
      })

      expect(client.projectPath).to.be.undefined
    })

    it('should set projectPath when provided', () => {
      const client = new ClientInfo({
        connectedAt: 1000,
        id: 'client-1',
        projectPath: '/Users/john/app',
        type: 'tui',
      })

      expect(client.projectPath).to.equal('/Users/john/app')
    })
  })

  describe('isExternalClient', () => {
    it('should return true for tui type', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'tui'})
      expect(client.isExternalClient).to.be.true
    })

    it('should return true for cli type', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'cli'})
      expect(client.isExternalClient).to.be.true
    })

    it('should return true for mcp type', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'mcp'})
      expect(client.isExternalClient).to.be.true
    })

    it('should return false for agent type', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'agent'})
      expect(client.isExternalClient).to.be.false
    })
  })

  describe('hasProject', () => {
    it('should return false when projectPath is undefined', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'mcp'})
      expect(client.hasProject).to.be.false
    })

    it('should return true when projectPath is set in constructor', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', projectPath: '/app', type: 'tui'})
      expect(client.hasProject).to.be.true
    })

    it('should return true after associateProject is called', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'mcp'})
      expect(client.hasProject).to.be.false

      client.associateProject('/app')
      expect(client.hasProject).to.be.true
    })
  })

  describe('associateProject()', () => {
    it('should set projectPath on first call', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'mcp'})

      client.associateProject('/Users/john/app')
      expect(client.projectPath).to.equal('/Users/john/app')
    })

    it('should update projectPath on subsequent calls', () => {
      const client = new ClientInfo({connectedAt: 1000, id: 'c1', type: 'mcp'})

      client.associateProject('/app-a')
      expect(client.projectPath).to.equal('/app-a')

      client.associateProject('/app-b')
      expect(client.projectPath).to.equal('/app-b')
    })
  })
})
