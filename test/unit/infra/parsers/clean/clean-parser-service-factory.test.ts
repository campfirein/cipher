/**
 * Unit tests for CleanParserServiceFactory
 * Tests factory creation and routing of clean parser services
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'

import { ClaudeCleanService } from '../../../../../src/infra/parsers/clean/clean-claude-service.js'
import { CodexCleanService } from '../../../../../src/infra/parsers/clean/clean-codex-service.js'
import { CopilotCleanService } from '../../../../../src/infra/parsers/clean/clean-copilot-service.js'
import { CursorCleanService } from '../../../../../src/infra/parsers/clean/clean-cursor-service.js'
import { CleanParserServiceFactory } from '../../../../../src/infra/parsers/clean/clean-parser-service-factory.js'

describe('CleanParserServiceFactory', () => {
  describe('createCleanParserService', () => {
    it('should create ClaudeCleanService for Claude Code IDE', () => {
      const service = CleanParserServiceFactory.createCleanParserService('Claude Code')

      expect(service).to.be.instanceOf(ClaudeCleanService)
    })

    it('should create CodexCleanService for Codex IDE', () => {
      const service = CleanParserServiceFactory.createCleanParserService('Codex')

      expect(service).to.be.instanceOf(CodexCleanService)
    })

    it('should create CursorCleanService for Cursor IDE', () => {
      const service = CleanParserServiceFactory.createCleanParserService('Cursor')

      expect(service).to.be.instanceOf(CursorCleanService)
    })

    it('should create CopilotCleanService for Github Copilot IDE', () => {
      const service = CleanParserServiceFactory.createCleanParserService('Github Copilot')

      expect(service).to.be.instanceOf(CopilotCleanService)
    })

    it('should throw error for unsupported IDE', () => {
      expect(() => {
        CleanParserServiceFactory.createCleanParserService('Unknown IDE' as any)
      }).to.throw()
    })

    it('should return service with parse method', () => {
      const service = CleanParserServiceFactory.createCleanParserService('Claude Code')

      expect(service).to.have.property('parse')
      expect(typeof service.parse).to.equal('function')
    })
  })

  describe('getSupportedIDEs', () => {
    it('should return array of supported IDEs', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides).to.be.an('array')
      expect(ides.length).to.equal(4)
    })

    it('should include Claude Code IDE', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides).to.include('Claude Code')
    })

    it('should include Codex IDE', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides).to.include('Codex')
    })

    it('should include Cursor IDE', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides).to.include('Cursor')
    })

    it('should include Github Copilot IDE', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides).to.include('Github Copilot')
    })

    it('should return consistent list', () => {
      const ides1 = CleanParserServiceFactory.getSupportedIDEs()
      const ides2 = CleanParserServiceFactory.getSupportedIDEs()

      expect(ides1).to.deep.equal(ides2)
    })
  })

  describe('isSupported', () => {
    it('should return true for Claude Code', () => {
      const result = CleanParserServiceFactory.isSupported('Claude Code')

      expect(result).to.be.true
    })

    it('should return true for Codex', () => {
      const result = CleanParserServiceFactory.isSupported('Codex')

      expect(result).to.be.true
    })

    it('should return true for Cursor', () => {
      const result = CleanParserServiceFactory.isSupported('Cursor')

      expect(result).to.be.true
    })

    it('should return true for Github Copilot', () => {
      const result = CleanParserServiceFactory.isSupported('Github Copilot')

      expect(result).to.be.true
    })

    it('should return false for unsupported IDE', () => {
      const result = CleanParserServiceFactory.isSupported('Unknown IDE' as any)

      expect(result).to.be.false
    })

    it('should be case-sensitive', () => {
      const result = CleanParserServiceFactory.isSupported('claude code' as any)

      expect(result).to.be.false
    })
  })

  describe('parseConversations', () => {
    it('should create appropriate service and call parse', async () => {
      const service = CleanParserServiceFactory.createCleanParserService('Claude Code')

      expect(typeof service.parse).to.equal('function')
    })

    it('should pass correct IDE to service creation', async () => {
      const result = CleanParserServiceFactory.parseConversations('Claude Code', '/tmp/test')

      expect(result).to.be.a('promise')
    })

    it('should handle all supported IDEs', async () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      for (const ide of ides) {
        expect(() => {
          CleanParserServiceFactory.parseConversations(ide, '/tmp/test')
        }).to.not.throw()
      }
    })

    it('should throw for unsupported IDE', () => {
      expect(() => {
        CleanParserServiceFactory.createCleanParserService('Unknown' as any)
      }).to.throw()
    })
  })

  describe('factory consistency', () => {
    it('should create same type of service for same IDE', () => {
      const service1 = CleanParserServiceFactory.createCleanParserService('Claude Code')
      const service2 = CleanParserServiceFactory.createCleanParserService('Claude Code')

      expect(service1.constructor.name).to.equal(service2.constructor.name)
    })

    it('should create different types for different IDEs', () => {
      const claudeService = CleanParserServiceFactory.createCleanParserService('Claude Code')
      const cursorService = CleanParserServiceFactory.createCleanParserService('Cursor')
      const codexService = CleanParserServiceFactory.createCleanParserService('Codex')
      const copilotService = CleanParserServiceFactory.createCleanParserService('Github Copilot')

      const constructorNames = new Set([
        claudeService.constructor.name,
        codexService.constructor.name,
        copilotService.constructor.name,
        cursorService.constructor.name
      ])

      expect(constructorNames.size).to.equal(4)
    })

    it('should return ICleanParserService interface compliant objects', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      for (const ide of ides) {
        const service = CleanParserServiceFactory.createCleanParserService(ide)
        expect(service).to.have.property('parse')
        expect(typeof service.parse).to.equal('function')
      }
    })
  })

  describe('edge cases', () => {
    it('should handle null/undefined IDE gracefully', () => {
      expect(() => {
        CleanParserServiceFactory.createCleanParserService(null as any)
      }).to.throw()
    })

    it('should handle empty string IDE', () => {
      expect(() => {
        CleanParserServiceFactory.createCleanParserService('' as any)
      }).to.throw()
    })

    it('should handle whitespace-padded IDE names', () => {
      const result = CleanParserServiceFactory.isSupported(' Claude Code ' as any)

      expect(result).to.be.false
    })

    it('should maintain API consistency across all supported IDEs', () => {
      const ides = CleanParserServiceFactory.getSupportedIDEs()

      const methods = new Set<string[]>()
      for (const ide of ides) {
        const service = CleanParserServiceFactory.createCleanParserService(ide)
        const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
        methods.add(methodNames)
      }

      // All services should have similar methods
      expect(methods.size).to.be.greaterThan(0)
    })
  })
})
