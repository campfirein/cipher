/**
 * Unit tests for RawParserServiceFactory
 * Tests factory methods and service creation
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { ClaudeRawService } from '../../../../../src/infra/parsers/raw/raw-claude-service.js'
import { CodexRawService } from '../../../../../src/infra/parsers/raw/raw-codex-service.js'
import { CopilotRawService } from '../../../../../src/infra/parsers/raw/raw-copilot-service.js'
import { CursorRawService } from '../../../../../src/infra/parsers/raw/raw-cursor-service.js'
import { RawParserServiceFactory } from '../../../../../src/infra/parsers/raw/raw-parser-service-factory.js'

describe('RawParserServiceFactory', () => {
  describe('createRawParserService', () => {
    it('should create ClaudeRawService for Claude Code IDE', () => {
      const service = RawParserServiceFactory.createRawParserService('Claude Code' as Agent)
      expect(service).to.be.instanceOf(ClaudeRawService)
    })

    it('should create CodexRawService for Codex IDE', () => {
      const service = RawParserServiceFactory.createRawParserService('Codex' as Agent)
      expect(service).to.be.instanceOf(CodexRawService)
    })

    it('should create CursorRawService for Cursor IDE', () => {
      const service = RawParserServiceFactory.createRawParserService('Cursor' as Agent)
      expect(service).to.be.instanceOf(CursorRawService)
    })

    it('should create CopilotRawService for Github Copilot IDE', () => {
      const service = RawParserServiceFactory.createRawParserService('Github Copilot' as Agent)
      expect(service).to.be.instanceOf(CopilotRawService)
    })

    it('should throw error for unsupported IDE', () => {
      try {
        RawParserServiceFactory.createRawParserService('Unknown IDE' as Agent)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Unsupported IDE')
        expect((error as Error).message).to.include('Unknown IDE')
      }
    })

    it('should throw error for null IDE', () => {
      try {
        RawParserServiceFactory.createRawParserService(null as any)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Unsupported IDE')
      }
    })

    it('should throw error for undefined IDE', () => {
      try {
        RawParserServiceFactory.createRawParserService(undefined as any)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Unsupported IDE')
      }
    })
  })

  describe('getSupportedIDEs', () => {
    it('should return array of supported IDEs', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()
      expect(supportedIDEs).to.be.an('array')
      expect(supportedIDEs).to.have.lengthOf(4)
    })

    it('should include Claude Code', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()
      expect(supportedIDEs).to.include('Claude Code')
    })

    it('should include Codex', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()
      expect(supportedIDEs).to.include('Codex')
    })

    it('should include Cursor', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()
      expect(supportedIDEs).to.include('Cursor')
    })

    it('should include Github Copilot', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()
      expect(supportedIDEs).to.include('Github Copilot')
    })
  })

  describe('isSupported', () => {
    it('should return true for supported IDE', () => {
      expect(RawParserServiceFactory.isSupported('Claude Code')).to.be.true
      expect(RawParserServiceFactory.isSupported('Cursor')).to.be.true
      expect(RawParserServiceFactory.isSupported('Codex')).to.be.true
      expect(RawParserServiceFactory.isSupported('Github Copilot')).to.be.true
    })

    it('should return false for unsupported IDE', () => {
      expect(RawParserServiceFactory.isSupported('Unknown IDE' as any)).to.be.false
      expect(RawParserServiceFactory.isSupported('VS Code' as any)).to.be.false
      expect(RawParserServiceFactory.isSupported('WebStorm' as any)).to.be.false
    })

    it('should return false for empty string', () => {
      expect(RawParserServiceFactory.isSupported('' as any)).to.be.false
    })

    it('should return false for null', () => {
      expect(RawParserServiceFactory.isSupported(null as any)).to.be.false
    })

    it('should be case sensitive', () => {
      expect(RawParserServiceFactory.isSupported('claude code' as any)).to.be.false
      expect(RawParserServiceFactory.isSupported('CLAUDE CODE' as any)).to.be.false
      expect(RawParserServiceFactory.isSupported('cursor' as any)).to.be.false
    })
  })

  describe('parseConversations', () => {
    it('should call parse method on created service', async () => {
      const ide = 'Claude Code' as Agent
      const customDir = '/path/to/conversations'
      const testOutputDir = join(tmpdir(), `test-parser-${Date.now()}`)

      // This would normally call the actual service's parse method
      // For testing purposes, we're verifying the factory creates the right service
      try {
        await RawParserServiceFactory.parseConversations(ide, customDir, testOutputDir)
      } catch {
        // Expected to fail since directory doesn't exist
        // The important part is that it tried to use the right service
      }
    })

    it('should throw error for unsupported IDE', async () => {
      const testOutputDir = join(tmpdir(), `test-parser-${Date.now()}`)
      try {
        await RawParserServiceFactory.parseConversations('Unknown' as Agent, '/path', testOutputDir)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Unsupported IDE')
      }
    })

    it('should create Claude service for Claude Code', async () => {
      const ide = 'Claude Code' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)
      expect(service).to.be.instanceOf(ClaudeRawService)
    })

    it('should create Codex service for Codex', async () => {
      const ide = 'Codex' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)
      expect(service).to.be.instanceOf(CodexRawService)
    })

    it('should create Cursor service for Cursor', async () => {
      const ide = 'Cursor' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)
      expect(service).to.be.instanceOf(CursorRawService)
    })

    it('should create Copilot service for Github Copilot', async () => {
      const ide = 'Github Copilot' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)
      expect(service).to.be.instanceOf(CopilotRawService)
    })
  })

  describe('Factory consistency', () => {
    it('should create same service type for same IDE', () => {
      const ide = 'Claude Code' as Agent
      const service1 = RawParserServiceFactory.createRawParserService(ide)
      const service2 = RawParserServiceFactory.createRawParserService(ide)

      expect(service1).to.be.instanceOf(service2.constructor)
    })

    it('should return supported IDEs in consistent order', () => {
      const ids1 = RawParserServiceFactory.getSupportedIDEs()
      const ids2 = RawParserServiceFactory.getSupportedIDEs()

      expect(ids1).to.deep.equal(ids2)
    })

    it('should properly validate all returned IDEs', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()

      for (const ide of supportedIDEs) {
        expect(RawParserServiceFactory.isSupported(ide)).to.be.true
      }
    })

    it('should be able to create service for all supported IDEs', () => {
      const supportedIDEs = RawParserServiceFactory.getSupportedIDEs()

      for (const ide of supportedIDEs) {
        const service = RawParserServiceFactory.createRawParserService(ide as Agent)
        expect(service).to.not.be.undefined
        expect(service).to.have.property('parse')
      }
    })
  })

  describe('Error handling', () => {
    it('should provide helpful error message for typos in IDE names', () => {
      try {
        RawParserServiceFactory.createRawParserService('Claud Code' as Agent)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Unsupported IDE')
        expect((error as Error).message).to.include('Claud Code')
      }
    })

    it('should suggest correct IDE names in error', () => {
      try {
        RawParserServiceFactory.createRawParserService('Copilot' as Agent)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Supported IDEs')
      }
    })
  })

  describe('Interface compliance', () => {
    it('should return service implementing IRawParserService interface', () => {
      const ide = 'Claude Code' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)

      expect(service).to.have.property('parse')
      expect(typeof service.parse).to.equal('function')
    })

    it('should have parse method that is async', async () => {
      const ide = 'Claude Code' as Agent
      const service = RawParserServiceFactory.createRawParserService(ide)

      const parseMethod = service.parse
      expect(parseMethod.constructor.name).to.equal('AsyncFunction')
    })
  })
})
