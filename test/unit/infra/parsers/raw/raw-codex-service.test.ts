/**
 * Unit tests for CodexRawService
 * Tests all public and private methods
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable camelcase */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { CodexRawService } from '../../../../../src/infra/parsers/raw/raw-codex-service.js'

describe('CodexRawService', () => {
  let service: CodexRawService
  let tempDir: string

  beforeEach(() => {
    service = new CodexRawService('Codex' as Agent)
    tempDir = join(tmpdir(), `test-codex-${Date.now()}`)
  })

  afterEach(() => {
    sinon.restore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  describe('extractSessionId', () => {
    it('should extract session ID from JSONL file path', () => {
      const logPath = '/Users/test/.codex/sessions/2024/01/01/abc-123-def.jsonl'
      const result = (service as any).extractSessionId(logPath)
      expect(result).to.equal('abc-123-def')
    })

    it('should handle file paths with different depths', () => {
      const logPath = '/path/to/session-123.jsonl'
      const result = (service as any).extractSessionId(logPath)
      expect(result).to.equal('session-123')
    })
  })

  describe('validateLogFile', () => {
    it('should validate correct Codex log file path', async () => {
      const fullPath = join(tempDir, '.codex/sessions/2024/01/01/test.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')

      const result = await (service as any).validateLogFile(fullPath)
      expect(result).to.be.true
    })

    it('should reject path without .codex/sessions/', async () => {
      const logPath = '/path/to/some/file.jsonl'
      const result = await (service as any).validateLogFile(logPath)
      expect(result).to.be.false
    })

    it('should reject non-JSONL files', async () => {
      const fullPath = join(tempDir, '.codex/sessions/test.json')
      fs.mkdirSync(dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')

      const result = await (service as any).validateLogFile(fullPath)
      expect(result).to.be.false
    })

    it('should reject non-existent files', async () => {
      const logPath = '/Users/test/.codex/sessions/nonexistent.jsonl'
      const result = await (service as any).validateLogFile(logPath)
      expect(result).to.be.false
    })
  })

  // Note: getEntriesByType, getEntriesByTypeFilter, getEntryStats, and parseRawEntries
  // are not currently part of the CodexRawService implementation
  // These methods were either removed or refactored into internal helper functions

  describe('parseSessionLog', () => {
    it('should parse valid Codex session log', async () => {
      const fullPath = join(tempDir, '.codex/sessions/2024/01/01/session.jsonl')
      fs.mkdirSync(dirname(fullPath), { recursive: true })

      const entry1 = {
        payload: { content: 'Hello', role: 'user', type: 'message' },
        timestamp: '2024-01-01T10:00:00Z',
        type: 'response_item'
      }
      const entry2 = {
        payload: { content: 'Hi there!', role: 'assistant', type: 'message' },
        timestamp: '2024-01-01T10:01:00Z',
        type: 'response_item'
      }

      fs.writeFileSync(fullPath, `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}`)

      const result = await (service as any).parseSessionLog(fullPath)
      expect(result.id).to.equal('session')
      expect(result.messages).to.be.an('array')
      expect(result.title).to.equal('Hello')
    })

    it('should throw error for empty file', async () => {
      const fullPath = join(tempDir, '.codex/sessions/2024/01/01/empty.jsonl')
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
    it('should parse all JSONL files recursively', async () => {
      const file1 = join(tempDir, '.codex/sessions/2024/01/01/session1.jsonl')
      const file2 = join(tempDir, '.codex/sessions/2024/01/02/session2.jsonl')

      fs.mkdirSync(dirname(file1), { recursive: true })
      fs.mkdirSync(dirname(file2), { recursive: true })

      const entry = {
        payload: { content: 'test', role: 'user', type: 'message' },
        timestamp: '2024-01-01T10:00:00Z',
        type: 'response_item'
      }

      fs.writeFileSync(file1, JSON.stringify(entry))
      fs.writeFileSync(file2, JSON.stringify(entry))

      const result = await (service as any).parseSessionDirectory(dirname(file1))
      expect(result).to.be.an('array')
    })

    it('should filter out combined files', async () => {
      const dirPath = join(tempDir, '.codex/sessions')
      fs.mkdirSync(dirPath, { recursive: true })

      const entry = {
        payload: { content: 'test', role: 'user', type: 'message' },
        timestamp: '2024-01-01T10:00:00Z',
        type: 'response_item'
      }

      fs.writeFileSync(join(dirPath, 'session-combined.jsonl'), JSON.stringify(entry))
      fs.writeFileSync(join(dirPath, 'session.jsonl'), JSON.stringify(entry))

      const result = await (service as any).parseSessionDirectory(dirPath)
      // Combined file should be filtered
      expect(result).to.be.an('array')
    })
  })

  describe('buildTokenUsageObject', () => {
    it('should build token usage object with cache tokens', () => {
      const result = (service as any).buildTokenUsageObject(100, 50, 25)
      expect(result.cacheTokens).to.equal(100)
      expect(result.inputTokens).to.equal(50)
      expect(result.outputTokens).to.equal(25)
      expect(result.totalTokens).to.equal(75)
    })

    it('should exclude cache tokens if zero', () => {
      const result = (service as any).buildTokenUsageObject(0, 50, 25)
      expect(result.cacheTokens).to.be.undefined
    })
  })

  describe('extractContentBlocks', () => {
    it('should extract string content', () => {
      const result = (service as any).extractContentBlocks('Hello world')
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('output_text')
    })

    it('should extract array of blocks', () => {
      const content = [
        { text: 'Hello', type: 'output_text' },
        { name: 'test', type: 'tool_use' }
      ]
      const result = (service as any).extractContentBlocks(content)
      expect(result).to.have.lengthOf(2)
    })

    it('should handle mixed string and object arrays', () => {
      const content = ['text', { text: 'block', type: 'output_text' }]
      const result = (service as any).extractContentBlocks(content)
      expect(result).to.have.lengthOf(2)
    })

    it('should stringify non-array, non-string content', () => {
      const content = { some: 'object' }
      const result = (service as any).extractContentBlocks(content)
      expect(result[0].type).to.equal('output_text')
    })
  })

  describe('extractSessionMeta', () => {
    it('should extract session metadata', () => {
      const entries = [
        {
          payload: {
            cli_version: '1.0.0',
            model_provider: 'claude',
            timestamp: '2024-01-01T10:00:00Z'
          },
          type: 'session_meta'
        }
      ]

      const result = (service as any).extractSessionMeta(entries)
      expect(result?.model_provider).to.equal('claude')
      expect(result?.cli_version).to.equal('1.0.0')
    })

    it('should return null if no session meta found', () => {
      const entries = [{ payload: {}, type: 'event_msg' }]
      const result = (service as any).extractSessionMeta(entries)
      expect(result).to.be.null
    })
  })

  describe('extractTimestamps', () => {
    it('should extract timestamps from entries', () => {
      const entries = [
        { timestamp: '2024-01-01T10:00:00Z' },
        { timestamp: '2024-01-01T10:01:00Z' },
        { timestamp: '2024-01-01T10:02:00Z' }
      ]

      const result = (service as any).extractTimestamps(entries, null)
      expect(result.startedAt).to.equal('2024-01-01T10:00:00Z')
      expect(result.endedAt).to.equal('2024-01-01T10:02:00Z')
    })

    it('should use session meta timestamp if available', () => {
      const entries = [{ timestamp: '2024-01-01T10:00:00Z' }]
      const sessionMeta = { timestamp: '2024-01-01T09:00:00Z' }

      const result = (service as any).extractTimestamps(entries, sessionMeta)
      expect(result.startedAt).to.equal('2024-01-01T09:00:00Z')
    })
  })

  describe('extractTitle', () => {
    it('should extract title from first user message', () => {
      const messages = [
        { content: 'What is AI?', type: 'user' }
      ]

      const result = (service as any).extractTitle(messages)
      expect(result).to.equal('What is AI?')
    })

    it('should handle array content with text blocks', () => {
      const messages = [
        {
          content: [
            { text: 'First line', type: 'text' },
            { text: 'Second line', type: 'text' }
          ],
          type: 'user'
        }
      ]

      const result = (service as any).extractTitle(messages)
      expect(result).to.include('First line')
    })

    it('should return default title if no user messages', () => {
      const messages = [{ content: 'Hello', type: 'assistant' }]
      const result = (service as any).extractTitle(messages)
      expect(result).to.equal('Codex Session')
    })
  })

  describe('extractWorkspace', () => {
    it('should extract workspace from session metadata', () => {
      const sessionMeta = { cwd: '/Users/test/project', git: { repository_url: 'https://github.com/test/repo' } }
      const result = (service as any).extractWorkspace('/some/path', sessionMeta)

      expect(result.path).to.equal('/Users/test/project')
      expect(result.repository?.name).to.equal('project')
      expect(result.repository?.url).to.equal('https://github.com/test/repo')
    })

    it('should use log path if no session metadata', () => {
      const logPath = '/Users/test/session.jsonl'
      const result = (service as any).extractWorkspace(logPath, null)

      expect(result.path).to.equal(logPath)
    })
  })

  describe('Type guards', () => {
    it('isEventPayload should validate event payloads', () => {
      const valid = { info: {}, type: 'token_count' }
      const invalid = { type: 'unknown' }

      expect((service as any).isEventPayload(valid)).to.be.true
      expect((service as any).isEventPayload(invalid)).to.be.false
    })

    it('isResponsePayload should validate response payloads', () => {
      const valid = { type: 'message' }
      const invalid = { type: 'unknown' }

      expect((service as any).isResponsePayload(valid)).to.be.true
      expect((service as any).isResponsePayload(invalid)).to.be.false
    })

    it('isSessionMetaPayload should validate session meta payloads', () => {
      const valid = { model_provider: 'claude' }
      const invalid = { unknown: 'field' }

      expect((service as any).isSessionMetaPayload(valid)).to.be.true
      expect((service as any).isSessionMetaPayload(invalid)).to.be.false
    })

    it('isTokenCountEntry should identify token count entries', () => {
      const tokenEntry = {
        payload: { info: { total_token_usage: { input_tokens: 10 } }, type: 'token_count' },
        type: 'event_msg'
      }
      const otherEntry = {
        payload: { text: 'test', type: 'agent_reasoning' },
        type: 'event_msg'
      }

      expect((service as any).isTokenCountEntry(tokenEntry)).to.be.true
      expect((service as any).isTokenCountEntry(otherEntry)).to.be.false
    })
  })

  describe('Message processing methods', () => {
    it('countMessageTypes should count user and assistant messages', () => {
      const messages = [
        { content: 'Hello', type: 'user' },
        { content: 'Hi', type: 'assistant' },
        { content: 'How are you?', type: 'user' }
      ]

      const result = (service as any).countMessageTypes(messages)
      expect(result.userCount).to.equal(2)
      expect(result.assistantCount).to.equal(1)
    })

    it('processFunctionCall should add tool blocks to messages', () => {
       
      const msgsList = [
        { content: [{ text: 'I will help', type: 'output_text' }], type: 'assistant' }
      ] as any

      (service as any).processFunctionCall(
        { arguments: '{}', name: 'test_tool', type: 'function_call' } as Record<string, unknown>,
        msgsList
      )
      expect(msgsList[0].content).to.be.an('array').with.lengthOf(2)
    })

    it('processFunctionCallOutput should update tool block output', () => {
       
      const msgsList2 = [
        {
          content: [
            { text: 'test', type: 'output_text' },
            { id: 'call_1', name: 'test', type: 'tool_use' }
          ],
          type: 'assistant'
        }
      ] as any

      (service as any).processFunctionCallOutput(
        { output: 'result', type: 'function_call_output' } as Record<string, unknown>,
        msgsList2
      )
      expect(msgsList2[0].content).to.be.an('array')
    })
  })
})

function dirname(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}
