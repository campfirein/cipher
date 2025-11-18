/**
 * Unit tests for CopilotRawService
 * Tests all public and private methods
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { CopilotRawService } from '../../../../../src/infra/parsers/raw/raw-copilot-service.js'

describe('CopilotRawService', () => {
  let service: CopilotRawService
  let tempDir: string

  beforeEach(() => {
    service = new CopilotRawService('Github Copilot' as Agent)
    tempDir = join(tmpdir(), `test-copilot-${Date.now()}`)
  })

  afterEach(() => {
    sinon.restore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  describe('calculateTotalDuration', () => {
    it('should calculate total duration from request timings', () => {
      const requests = [
        { result: { timings: { totalElapsed: 100 } } },
        { result: { timings: { totalElapsed: 200 } } },
        { result: { timings: { totalElapsed: 150 } } }
      ]

      const result = (service as any).calculateTotalDuration(requests)
      expect(result).to.equal(450)
    })

    it('should handle requests without timings', () => {
      const requests = [
        { result: {} },
        { result: { timings: { totalElapsed: 100 } } }
      ]

      const result = (service as any).calculateTotalDuration(requests)
      expect(result).to.equal(100)
    })

    it('should return 0 for empty requests array', () => {
      const result = (service as any).calculateTotalDuration([])
      expect(result).to.equal(0)
    })
  })

  describe('extractAttachments', () => {
    it('should extract attachment names from variables', () => {
      const variableData = {
        variables: [
          { name: 'file1.ts' },
          { name: 'file2.js' },
          { name: 'folder/' }
        ]
      }

      const result = (service as any).extractAttachments(variableData)
      expect(result).to.deep.equal(['file1.ts', 'file2.js', 'folder/'])
    })

    it('should return empty array if no variables', () => {
      const result = (service as any).extractAttachments()
      expect(result).to.deep.equal([])
    })

    it('should filter out variables without names', () => {
      const variableData = {
        variables: [{ name: 'file.ts' }, {}, { name: 'other.ts' }]
      }

      const result = (service as any).extractAttachments(variableData)
      expect(result).to.have.lengthOf(2)
    })
  })

  describe('extractTitle', () => {
    it('should extract title from first message', () => {
      const requests = [{ message: { text: 'How do I debug this?' } }]
      const messages = [{ content: 'How do I debug this?', type: 'user' }]

      const result = (service as any).extractTitle(requests, messages)
      expect(result).to.equal('How do I debug this?')
    })

    it('should truncate long titles', () => {
      const longText = 'a'.repeat(200)
      const messages = [{ content: longText, type: 'user' }]

      const result = (service as any).extractTitle([], messages)
      expect(result.length).to.equal(103) // TITLE_TRUNCATE_LENGTH (100) + '...' (3)
      expect(result).to.include('...')
    })

    it('should use request message if messages empty', () => {
      const requests = [{ message: { text: 'Test message' } }]
      const messages: any[] = []

      const result = (service as any).extractTitle(requests, messages)
      expect(result).to.equal('Test message')
    })

    it('should return default title if no messages', () => {
      const result = (service as any).extractTitle([], [])
      expect(result).to.equal('Copilot Chat Session')
    })
  })

  describe('extractMetadata', () => {
    it('should extract metadata from session data', () => {
      const data = {
        initialLocation: '/src/app.ts',
        requesterUsername: 'testuser',
        requests: [
          { result: { timings: { totalElapsed: 100 } } },
          { result: { timings: { totalElapsed: 200 } } }
        ],
        responderUsername: 'GitHub Copilot'
      }

      const result = (service as any).extractMetadata(data, 'session-123', 'workspace-hash')

      expect(result.requesterUsername).to.equal('testuser')
      expect(result.requestCount).to.equal(2)
      expect(result.sessionId).to.equal('session-123')
      expect(result.totalDuration).to.equal(300)
    })

    it('should use default values for missing fields', () => {
      const data = { requests: [] }

      const result = (service as any).extractMetadata(data, 'id', 'hash')

      expect(result.requesterUsername).to.equal('Unknown')
      expect(result.responderUsername).to.equal('GitHub Copilot')
      expect(result.initialLocation).to.equal('unknown')
    })
  })

  describe('convertRequestsToMessages', () => {
    it('should convert requests to user and assistant messages', () => {
      const requests = [
        {
          message: { text: 'Hello' },
          response: [{ text: 'Hi there!', type: 'text' }]
        }
      ]

      const result = (service as any).convertRequestsToMessages(requests)
      expect(result).to.have.lengthOf(2)
      expect(result[0].type).to.equal('user')
      expect(result[1].type).to.equal('assistant')
    })

    it('should handle requests without messages', () => {
      const requests = [{ response: [{ text: 'Response', type: 'text' }] }]

      const result = (service as any).convertRequestsToMessages(requests)
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('assistant')
    })

    it('should handle requests without responses', () => {
      const requests = [{ message: { text: 'Question' } }]

      const result = (service as any).convertRequestsToMessages(requests)
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('user')
    })
  })

  describe('normalizeContentBlock', () => {
    it('should return string content as-is', () => {
      const result = (service as any).normalizeContentBlock('Hello world')
      expect(result).to.equal('Hello world')
    })

    it('should add kind field to block objects', () => {
      const block = { kind: 'text_block', text: 'Hello', type: 'text' }
      const result = (service as any).normalizeContentBlock(block)

      expect(result.kind).to.equal('text_block')
      expect(result.type).to.equal('text')
    })

    it('should add default kind if missing', () => {
      const block = { text: 'Hello', type: 'text' }
      const result = (service as any).normalizeContentBlock(block)

      expect(result.kind).to.equal('unknown')
    })

    it('should stringify non-string, non-object content', () => {
      const result = (service as any).normalizeContentBlock(null)
      expect(result).to.be.a('string')
    })
  })

  describe('normalizeParsedRequest', () => {
    it('should normalize request data', () => {
      const request = {
        message: { text: 'test' },
        requestId: 'req-123',
        response: [{ text: 'response', type: 'text' }],
        responseId: 'res-123',
        result: { status: 'success' }
      }

      const result = (service as any).normalizeParsedRequest(request)

      expect(result.requestId).to.equal('req-123')
      expect(result.message).to.deep.equal({ text: 'test' })
      expect(result.response).to.be.an('array')
    })

    it('should provide defaults for missing fields', () => {
      const request = {}

      const result = (service as any).normalizeParsedRequest(request)

      expect(result.requestId).to.equal('')
      expect(result.responseId).to.equal('')
      expect(result.message).to.deep.equal({})
    })
  })

  // Note: exportSessions is not currently part of the CopilotRawService implementation
  // Session export functionality has been refactored or is handled internally

  describe('parseSessionFile', () => {
    it('should parse session file', () => {
      const sessionFile = join(tempDir, 'session-123.json')
      fs.mkdirSync(tempDir, { recursive: true })

      const sessionData = {
        requesterUsername: 'testuser',
        requests: [
          {
            message: { text: 'Hello' },
            response: [{ text: 'Hi', type: 'text' }]
          }
        ]
      }

      fs.writeFileSync(sessionFile, JSON.stringify(sessionData))

      const result = (service as any).parseSessionFile(sessionFile, 'workspace-hash')

      expect(result).to.not.be.null
      expect(result?.id).to.equal('session-123')
      expect(result?.messages).to.be.an('array')
    })

    it('should handle parse errors gracefully', () => {
      const sessionFile = join(tempDir, 'invalid.json')
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(sessionFile, 'invalid json content')

      const result = (service as any).parseSessionFile(sessionFile, 'hash')
      expect(result).to.be.null
    })
  })

  describe('parseFromDirectory', () => {
    it('should parse sessions from direct workspace directory', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      const chatSessionsDir = join(workspaceDir, 'chatSessions')
      fs.mkdirSync(chatSessionsDir, { recursive: true })

      const sessionData = {
        requesterUsername: 'user',
        requests: []
      }

      fs.writeFileSync(join(chatSessionsDir, 'session-1.json'), JSON.stringify(sessionData))

      const result = await (service as any).parseFromDirectory(workspaceDir)
      expect(result).to.be.an('array')
    })

    it('should parse sessions from parent directory with workspace subdirs', async () => {
      const parentDir = join(tempDir, 'parent')
      const workspaceDir = join(parentDir, 'workspace-hash')
      const chatSessionsDir = join(workspaceDir, 'chatSessions')
      fs.mkdirSync(chatSessionsDir, { recursive: true })

      const sessionData = { requesterUsername: 'user', requests: [] }
      fs.writeFileSync(join(chatSessionsDir, 'session-1.json'), JSON.stringify(sessionData))

      const result = await (service as any).parseFromDirectory(parentDir)
      expect(result).to.be.an('array')
    })
  })

  describe('parseWorkspaceDirectory', () => {
    it('should parse all session files in workspace', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      const chatSessionsDir = join(workspaceDir, 'chatSessions')
      fs.mkdirSync(chatSessionsDir, { recursive: true })

      const sessionData = { requesterUsername: 'user', requests: [] }
      fs.writeFileSync(join(chatSessionsDir, 'session-1.json'), JSON.stringify(sessionData))
      fs.writeFileSync(join(chatSessionsDir, 'session-2.json'), JSON.stringify(sessionData))

      const result = await (service as any).parseWorkspaceDirectory(workspaceDir, 'workspace-hash')
      expect(result).to.have.lengthOf(2)
    })

    it('should return empty array if chatSessions dir not found', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      fs.mkdirSync(workspaceDir, { recursive: true })

      const result = await (service as any).parseWorkspaceDirectory(workspaceDir, 'hash')
      expect(result).to.have.lengthOf(0)
    })

    it('should skip non-JSON files', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      const chatSessionsDir = join(workspaceDir, 'chatSessions')
      fs.mkdirSync(chatSessionsDir, { recursive: true })

      const sessionData = { requesterUsername: 'user', requests: [] }
      fs.writeFileSync(join(chatSessionsDir, 'session.json'), JSON.stringify(sessionData))
      fs.writeFileSync(join(chatSessionsDir, 'readme.txt'), 'text file')

      const result = await (service as any).parseWorkspaceDirectory(workspaceDir, 'hash')
      expect(result).to.have.lengthOf(1)
    })
  })

  describe('extractWorkspacePath', () => {
    it('should try Tier 1A (SQLite) first', () => {
      const data = { baseUri: { path: '/path/from/data' } }
      // Mock Tier 1A to return null
      sinon.stub(service as any, 'extractWorkspacePathTier1A').returns(null)
      sinon.stub(service as any, 'extractWorkspacePathTier1B').returns('/fallback/path')

      const result = (service as any).extractWorkspacePath(data, 'hash')
      expect(result).to.equal('/fallback/path')
    })

    it('should return null if both tiers fail', () => {
      const data = {}
      sinon.stub(service as any, 'extractWorkspacePathTier1A').returns(null)
      sinon.stub(service as any, 'extractWorkspacePathTier1B').returns(null)

      const result = (service as any).extractWorkspacePath(data, 'hash')
      expect(result).to.be.null
    })
  })

  describe('extractWorkspacePathTier1B', () => {
    it('should extract workspace path from baseUri', () => {
      const data = {
        some: {
          nested: {
            baseUri: { path: '/Users/test/workspace' }
          }
        }
      }

      const result = (service as any).extractWorkspacePathTier1B(data)
      expect(result).to.equal('/Users/test/workspace')
    })

    it('should return null if no baseUri found', () => {
      const data = { other: 'data' }

      const result = (service as any).extractWorkspacePathTier1B(data)
      expect(result).to.be.null
    })

    it('should traverse nested objects', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              baseUri: { path: '/deep/path' }
            }
          }
        }
      }

      const result = (service as any).extractWorkspacePathTier1B(data)
      expect(result).to.equal('/deep/path')
    })
  })
})
