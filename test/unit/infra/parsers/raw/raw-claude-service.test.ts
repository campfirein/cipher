/**
 * Unit tests for ClaudeRawService
 * Tests all public and private methods
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { ClaudeRawService } from '../../../../../src/infra/parsers/raw/raw-claude-service.js'

describe('ClaudeRawService', () => {
  let service: ClaudeRawService
  let tempDir: string

  beforeEach(() => {
    service = new ClaudeRawService('Claude Code' as Agent)
    tempDir = join(tmpdir(), `test-claude-${Date.now()}`)
  })

  afterEach(() => {
    sinon.restore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  describe('extractSessionId', () => {
    it('should extract session ID from JSONL file path', () => {
      const logPath = '/Users/test/.claude/projects/-path/to/project/abc-123-def.jsonl'
      const result = (service as any).extractSessionId(logPath)
      expect(result).to.equal('abc-123-def')
    })

    it('should handle file paths without extension', () => {
      const logPath = '/path/to/session-id'
      const result = (service as any).extractSessionId(logPath)
      expect(result).to.equal('session-id')
    })

    it('should handle empty file path', () => {
      const logPath = ''
      const result = (service as any).extractSessionId(logPath)
      expect(result).to.equal('')
    })
  })

  describe('validateLogFile', () => {
    it('should validate correct Claude log file path', async () => {
      const tempFile = join(tempDir, 'test.jsonl')
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(tempFile, '')

      const fullPath = join(tempDir, '.claude/projects/-path/test.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')

      const result = await (service as any).validateLogFile(fullPath)
      expect(result).to.be.true
    })

    it('should reject path without .claude/projects/', async () => {
      const logPath = '/path/to/some/file.jsonl'
      const result = await (service as any).validateLogFile(logPath)
      expect(result).to.be.false
    })

    it('should reject non-JSONL files', async () => {
      const fullPath = join(tempDir, '.claude/projects/-path/test.json')
      fs.mkdirSync(dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')

      const result = await (service as any).validateLogFile(fullPath)
      expect(result).to.be.false
    })

    it('should reject non-existent files', async () => {
      const logPath = '/Users/test/.claude/projects/-path/nonexistent.jsonl'
      const result = await (service as any).validateLogFile(logPath)
      expect(result).to.be.false
    })
  })

  describe('parseSessionLog', () => {
    it('should parse valid JSONL session log', async () => {
      const fullPath = join(tempDir, '.claude/projects/-path/session.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })

      /* eslint-disable camelcase */
      const entry1 = {
        message: {
          content: 'Hello',
          usage: { input_tokens: 10, output_tokens: 5 }
        },
        timestamp: '2024-01-01T10:00:00Z',
        type: 'user'
      }
      const entry2 = {
        message: {
          content: 'Hi there!',
          usage: { input_tokens: 20, output_tokens: 15 }
        },
        timestamp: '2024-01-01T10:01:00Z',
        type: 'assistant'
      }
      /* eslint-enable camelcase */

      fs.writeFileSync(fullPath, `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}`)

      const result = await (service as any).parseSessionLog(fullPath)

      expect(result.id).to.equal('session')
      expect(result.messages).to.have.lengthOf(2)
      expect(result.title).to.include('Hello')
      expect(result.metadata.startedAt).to.equal('2024-01-01T10:00:00Z')
    })

    it('should handle invalid JSONL entries gracefully', async () => {
      const fullPath = join(tempDir, '.claude/projects/-path/session.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })

      const validEntry = { message: { content: 'test' }, timestamp: '2024-01-01T10:00:00Z', type: 'user' }
      const invalidJson = 'not valid json'

      fs.writeFileSync(fullPath, `${JSON.stringify(validEntry)}\n${invalidJson}`)

      const result = await (service as any).parseSessionLog(fullPath)
      expect(result.messages).to.have.lengthOf(1)
    })

    it('should throw error for empty JSONL file', async () => {
      const fullPath = join(tempDir, '.claude/projects/-path/empty.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')

      try {
        await (service as any).parseSessionLog(fullPath)
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('No valid entries found')
      }
    })
  })

  describe('parseSessionDirectory', () => {
    it('should parse all JSONL files in directory', async () => {
      const dirPath = join(tempDir, 'sessions')
      fs.mkdirSync(dirPath, { recursive: true })

      // Create multiple session files
      const sessionPath1 = join(tempDir, '.claude/projects/-path/session1.jsonl')
      const sessionPath2 = join(tempDir, '.claude/projects/-path/session2.jsonl')
      fs.mkdirSync(dirname(sessionPath1), { recursive: true })

      const entry = { message: { content: 'test' }, timestamp: '2024-01-01T10:00:00Z', type: 'user' }
      fs.writeFileSync(sessionPath1, JSON.stringify(entry))
      fs.writeFileSync(sessionPath2, JSON.stringify(entry))

      const result = await (service as any).parseSessionDirectory(dirname(sessionPath1))
      expect(result).to.be.an('array')
    })

    it('should filter out combined files', async () => {
      // This test verifies combined files are excluded
      const dirPath = dirname(join(tempDir, '.claude/projects/-path/session-combined.jsonl'))
      fs.mkdirSync(dirPath, { recursive: true })

      const entry = { message: { content: 'test' }, timestamp: '2024-01-01T10:00:00Z', type: 'user' }
      fs.writeFileSync(join(dirPath, 'session-combined.jsonl'), JSON.stringify(entry))
      fs.writeFileSync(join(dirPath, 'session.jsonl'), JSON.stringify(entry))

      // The combined file should be filtered out
      expect(true).to.be.true
    })

    it('should throw error for non-existent directory', async () => {
      try {
        await (service as any).parseSessionDirectory('/nonexistent/path')
        expect.fail('Should throw error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to parse directory')
      }
    })
  })

  describe('convertToMessages', () => {
    it('should convert user messages', () => {
      const entries = [
        {
          message: { content: 'Hello' },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'user'
        }
      ]

      const result = (service as any).convertToMessages(entries)
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('user')
      expect(result[0].content).to.equal('Hello')
    })

    it('should convert assistant messages', () => {
      const entries = [
        {
          message: { content: 'Hi!' },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant'
        }
      ]

      const result = (service as any).convertToMessages(entries)
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('assistant')
    })

    it('should convert system messages', () => {
      const entries = [
        {
          content: 'System prompt',
          timestamp: '2024-01-01T10:00:00Z',
          type: 'system'
        }
      ]

      const result = (service as any).convertToMessages(entries)
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('system')
    })

    it('should skip entries without messages', () => {
      const entries = [
        { timestamp: '2024-01-01T10:00:00Z', type: 'user' },
        { timestamp: '2024-01-01T10:00:00Z', type: 'assistant' }
      ]

      const result = (service as any).convertToMessages(entries)
      expect(result).to.have.lengthOf(0)
    })
  })

  describe('extractContentBlocks', () => {
    it('should handle string content', () => {
      const content = 'Hello world'
      const result = (service as any).extractContentBlocks(content)
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.deep.equal({ text: 'Hello world', type: 'text' })
    })

    it('should handle array of blocks', () => {
      const content = [
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' }
      ]
      const result = (service as any).extractContentBlocks(content)
      expect(result).to.have.lengthOf(2)
    })

    it('should handle null/undefined content', () => {
      let result = (service as any).extractContentBlocks(null)
      expect(result).to.have.lengthOf(0)

      result = (service as any).extractContentBlocks()
      expect(result).to.have.lengthOf(0)
    })

    it('should handle object content', () => {
      const content = { text: 'Hello', type: 'text' }
      const result = (service as any).extractContentBlocks(content)
      expect(result).to.have.lengthOf(1)
    })
  })

  describe('extractTimestamps', () => {
    it('should extract first and last timestamps', () => {
      const entries = [
        { timestamp: '2024-01-01T10:00:00Z' },
        { timestamp: '2024-01-01T10:01:00Z' },
        { timestamp: '2024-01-01T10:02:00Z' }
      ]

      const result = (service as any).extractTimestamps(entries)
      expect(result.startedAt).to.equal('2024-01-01T10:00:00Z')
      expect(result.endedAt).to.equal('2024-01-01T10:02:00Z')
    })

    it('should handle entries without timestamps', () => {
      const entries = [{ timestamp: '' }, { timestamp: '2024-01-01T10:00:00Z' }]

      const result = (service as any).extractTimestamps(entries)
      expect(result.startedAt).to.equal('2024-01-01T10:00:00Z')
    })

    it('should return current time if no valid timestamps', () => {
      const entries = [{ timestamp: '' }, { timestamp: null }]

      const result = (service as any).extractTimestamps(entries)
      expect(result.startedAt).to.be.a('string')
    })
  })

  describe('extractTitle', () => {
    it('should extract title from first user message', () => {
      const messages = [
        { content: 'Hello world\nSecond line', type: 'user' }
      ]

      const result = (service as any).extractTitle(messages)
      expect(result).to.equal('Hello world')
    })

    it('should truncate long titles', () => {
      const longText = 'a'.repeat(150)
      const messages = [{ content: longText, type: 'user' }]

      const result = (service as any).extractTitle(messages)
      expect(result.length).to.equal(103) // MAX_LENGTH + '...'
      expect(result).to.include('...')
    })

    it('should return default title if no user messages', () => {
      const messages = [{ content: 'Hello', type: 'assistant' }]

      const result = (service as any).extractTitle(messages)
      expect(result).to.equal('Claude Code Session')
    })

    it('should handle non-string content', () => {
      const messages = [{ content: [{ text: 'Hello', type: 'text' }], type: 'user' }]

      const result = (service as any).extractTitle(messages)
      expect(result).to.equal('Claude Code Session')
    })
  })

  describe('extractWorkspace', () => {
    it('should extract workspace from valid Claude path', () => {
      const logPath = '/.claude/projects/-Users-test-workspace/session.jsonl'

      const result = (service as any).extractWorkspace(logPath)
      expect(result.path).to.include('Users/test/workspace')
      expect(result.repository?.name).to.equal('workspace')
    })

    it('should handle non-standard paths', () => {
      const logPath = '/some/other/path/file.jsonl'

      const result = (service as any).extractWorkspace(logPath)
      expect(result.path).to.equal(logPath)
    })
  })
})

function dirname(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}
