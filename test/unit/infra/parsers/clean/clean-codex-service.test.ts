/**
 * Unit tests for CodexCleanService
 * Tests transformation of Codex raw sessions to clean format
 */
/* eslint-disable @typescript-eslint/no-explicit-any, camelcase */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { CodexCleanService } from '../../../../../src/infra/parsers/clean/clean-codex-service.js'

describe('CodexCleanService', () => {
  let service: CodexCleanService
  let tempDir: string

  beforeEach(() => {
    service = new CodexCleanService('Codex' as Agent)
    tempDir = join(tmpdir(), `test-codex-clean-${Date.now()}`)
  })

  afterEach(() => {
    sinon.restore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  describe('parse', () => {
    it('should successfully parse raw directory with sessions', async () => {
      const inputDir = join(tempDir, 'raw')
      const dateDir = join(inputDir, '2024-01-01')
      fs.mkdirSync(dateDir, { recursive: true })

      const sessionData = {
        id: 'session-1',
        rawEntries: [
          {
            payload: {
              content: [
                { text: 'Hello', type: 'text' }
              ],
              role: 'user',
              type: 'message'
            },
            timestamp: Date.now(),
            type: 'response_item'
          }
        ],
        timestamp: Date.now(),
        title: 'Test Session'
      }

      fs.writeFileSync(
        join(dateDir, 'session-1.json'),
        JSON.stringify(sessionData)
      )

      const result = await service.parse(inputDir)
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.be.greaterThan(0)
    })

    it('should handle directory with no sessions', async () => {
      const inputDir = join(tempDir, 'raw')
      const dateDir = join(inputDir, '2024-01-01')
      fs.mkdirSync(dateDir, { recursive: true })

      const result = await service.parse(inputDir)
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.equal(0)
    })

    it('should handle parse errors gracefully', async () => {
      const inputDir = join(tempDir, 'raw')
      const dateDir = join(inputDir, '2024-01-01')
      fs.mkdirSync(dateDir, { recursive: true })

      fs.writeFileSync(
        join(dateDir, 'invalid.json'),
        'invalid json'
      )

      const result = await service.parse(inputDir)
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.equal(0)
    })

    it('should skip non-JSON files', async () => {
      const inputDir = join(tempDir, 'raw')
      const dateDir = join(inputDir, '2024-01-01')
      fs.mkdirSync(dateDir, { recursive: true })

      fs.writeFileSync(join(dateDir, 'readme.txt'), 'text file')

      const result = await service.parse(inputDir)
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.equal(0)
    })
  })

  describe('normalizeCodexSession', () => {
    it('should normalize a complete Codex session', () => {
      const session = {
        id: 'session-1',
        rawEntries: [
          {
            payload: {
              cli_version: '1.0.0',
              model_provider: 'openai',
              source: 'web'
            },
            type: 'session_meta'
          },
          {
            payload: {
              content: [{ text: 'Hello', type: 'text' }],
              role: 'user',
              type: 'message'
            },
            timestamp: '2024-01-01T10:00:00Z',
            type: 'response_item'
          }
        ],
        timestamp: 1_234_567_890,
        title: 'Test Session'
      }

      const result = (service as any).normalizeCodexSession(session)

      expect(result).to.have.property('id', 'session-1')
      expect(result).to.have.property('title', 'Test Session')
      expect(result).to.have.property('messages')
      expect(Array.isArray(result.messages)).to.be.true
    })

    it('should extract workspace paths from rawEntries', () => {
      const session = {
        id: 'session-1',
        rawEntries: [
          {
            payload: {
              cwd: '/Users/test/project',
              type: 'message',
              writable_roots: ['/Users/test/project/src']
            },
            timestamp: '2024-01-01T10:00:00Z',
            type: 'response_item'
          }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = (service as any).normalizeCodexSession(session)

      expect(result).to.have.property('workspacePaths')
      expect(Array.isArray(result.workspacePaths)).to.be.true
    })

    it('should handle empty rawEntries', () => {
      const session = {
        id: 'session-1',
        rawEntries: [],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = (service as any).normalizeCodexSession(session)

      expect(result).to.have.property('messages')
      expect(result.messages).to.be.an('array')
    })
  })

  describe('normalizeCodexContentBlock', () => {
    it('should normalize string content', () => {
      const block = 'Hello world'
      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result).to.deep.equal({ text: 'Hello world', type: 'text' })
    })

    it('should normalize text blocks', () => {
      const block = { text: 'Hello', type: 'text' }
      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('text')
      expect(result.text).to.equal('Hello')
    })

    it('should normalize thinking blocks', () => {
      const block = { thinking: 'Analyzing...', type: 'thinking' }
      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('thinking')
      expect(result.thinking).to.equal('Analyzing...')
    })

    it('should normalize tool_use blocks', () => {
      const block = {
        id: 'tool-1',
        input: { command: 'ls' },
        name: 'bash',
        type: 'tool_use'
      }

      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('tool_use')
      expect(result.name).to.equal('bash')
      expect(result.id).to.equal('tool-1')
    })

    it('should normalize tool_result blocks', () => {
      const block = {
        content: 'result output',
        tool_use_id: 'tool-1',
        type: 'tool_result'
      }

      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('tool_result')
      expect(result.tool_use_id).to.equal('tool-1')
    })

    it('should return null for invalid blocks', () => {
      const result = (service as any).normalizeCodexContentBlock(null)
      expect(result).to.be.null

      const result2 = (service as any).normalizeCodexContentBlock()
      expect(result2).to.be.null
    })

    it('should normalize input_text blocks (Codex format)', () => {
      const block = { text: 'User input', type: 'input_text' }
      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('text')
      expect(result.text).to.equal('User input')
    })

    it('should normalize output_text blocks (Codex format)', () => {
      const block = { text: 'Model output', type: 'output_text' }
      const result = (service as any).normalizeCodexContentBlock(block)

      expect(result.type).to.equal('text')
      expect(result.text).to.equal('Model output')
    })
  })

  describe('transformCodexEntries', () => {
    it('should transform response_items to messages', () => {
      const entries = [
        {
          payload: {
            content: [{ text: 'Hello', type: 'text' }],
            role: 'user',
            type: 'message'
          },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'response_item'
        },
        {
          payload: {
            content: [{ text: 'Hi there!', type: 'text' }],
            role: 'assistant',
            type: 'message'
          },
          timestamp: '2024-01-01T10:01:00Z',
          type: 'response_item'
        }
      ]

      const result = (service as any).transformCodexEntries(entries)

      expect(result).to.be.an('array')
      expect(result.length).to.be.greaterThan(0)
      expect(result[0]).to.have.property('type')
      expect(result[0]).to.have.property('content')
    })

    it('should filter out event_msg entries', () => {
      const entries = [
        {
          payload: { data: 'event' },
          type: 'event_msg'
        },
        {
          payload: {
            content: [{ text: 'Message', type: 'text' }],
            type: 'message'
          },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'response_item'
        }
      ]

      const result = (service as any).transformCodexEntries(entries)

      expect(result).to.have.lengthOf(1)
      expect(result[0].content[0].text).to.equal('Message')
    })

    it('should combine tool_use and tool_result messages', () => {
      const entries = [
        {
          payload: {
            call_id: 'tool-1',
            input: { command: 'ls' },
            name: 'bash',
            type: 'custom_tool_call'
          },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'response_item'
        },
        {
          payload: {
            call_id: 'tool-1',
            output: JSON.stringify({ output: 'file list' }),
            type: 'custom_tool_call_output'
          },
          timestamp: '2024-01-01T10:01:00Z',
          type: 'response_item'
        }
      ]

      const result = (service as any).transformCodexEntries(entries)

      expect(result).to.be.an('array')
      expect(result.length).to.be.greaterThan(0)
    })

    it('should add turn_id to messages', () => {
      const entries = [
        {
          payload: {
            content: [{ text: 'Message 1', type: 'text' }],
            type: 'message'
          },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'response_item'
        },
        {
          payload: {
            content: [{ text: 'Message 2', type: 'text' }],
            type: 'message'
          },
          timestamp: '2024-01-01T10:01:00Z',
          type: 'response_item'
        }
      ]

      const result = (service as any).transformCodexEntries(entries)

      for (const element of result) {
        const msg = element as Record<string, unknown>
        expect(msg).to.have.property('turn_id')
        expect(typeof msg.turn_id).to.equal('number')
      }
    })

    it('should sort messages by timestamp', () => {
      const entries = [
        {
          payload: {
            content: [{ text: 'Second', type: 'text' }],
            type: 'message'
          },
          timestamp: '2024-01-01T10:02:00Z',
          type: 'response_item'
        },
        {
          payload: {
            content: [{ text: 'First', type: 'text' }],
            type: 'message'
          },
          timestamp: '2024-01-01T10:00:00Z',
          type: 'response_item'
        }
      ]

      const result = (service as any).transformCodexEntries(entries)

      if (result.length >= 2) {
        const ts1 = new Date(result[0].timestamp).getTime()
        const ts2 = new Date(result[1].timestamp).getTime()
        expect(ts1).to.be.lessThanOrEqual(ts2)
      }
    })
  })

  describe('extractWorkspacePathsFromPayload', () => {
    it('should extract cwd from payload', () => {
      const payload = { cwd: '/Users/test/project' }
      const result = (service as any).extractWorkspacePathsFromPayload(payload)

      expect(result).to.include('/Users/test/project')
    })

    it('should extract writable_roots array', () => {
      const payload = {
        writable_roots: ['/Users/test/src', '/Users/test/tests']
      }

      const result = (service as any).extractWorkspacePathsFromPayload(payload)

      expect(result).to.include('/Users/test/src')
      expect(result).to.include('/Users/test/tests')
    })

    it('should extract writable_roots from sandbox_policy', () => {
      const payload = {
        sandbox_policy: {
          writable_roots: ['/tmp/sandbox']
        }
      }

      const result = (service as any).extractWorkspacePathsFromPayload(payload)

      expect(result).to.include('/tmp/sandbox')
    })

    it('should handle string writable_roots', () => {
      const payload = { writable_roots: '/Users/test' }
      const result = (service as any).extractWorkspacePathsFromPayload(payload)

      expect(result).to.include('/Users/test')
    })

    it('should return empty array when no paths found', () => {
      const payload = { other: 'data' }
      const result = (service as any).extractWorkspacePathsFromPayload(payload)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(0)
    })
  })

  describe('parseToolInput', () => {
    it('should handle custom_tool_call input', () => {
      const payload = { input: 'command to run' }
      const result = (service as any).parseToolInput(payload)

      expect(result).to.have.property('input', 'command to run')
    })

    it('should handle custom_tool_call with object input', () => {
      const payload = { input: { args: ['-la'], command: 'ls' } }
      const result = (service as any).parseToolInput(payload)

      expect(result).to.have.property('command')
    })

    it('should handle function_call with JSON string arguments', () => {
      const payload = { arguments: '{"param": "value"}' }
      const result = (service as any).parseToolInput(payload)

      expect(result).to.have.property('param', 'value')
    })

    it('should handle function_call with object arguments', () => {
      const payload = { arguments: { param: 'value' } }
      const result = (service as any).parseToolInput(payload)

      expect(result).to.have.property('param', 'value')
    })

    it('should handle invalid JSON in function_call', () => {
      const payload = { arguments: 'not json' }
      const result = (service as any).parseToolInput(payload)

      expect(result).to.deep.equal({ arguments: 'not json' })
    })

    it('should return empty object when no input/arguments', () => {
      const payload = {}
      const result = (service as any).parseToolInput(payload)

      expect(result).to.deep.equal({})
    })
  })

  describe('extractToolOutput', () => {
    it('should extract string output directly', () => {
      const payload = { output: 'result text' }
      const result = (service as any).extractToolOutput(payload)

      expect(result).to.equal('result text')
    })

    it('should parse JSON string output', () => {
      const payload = { output: JSON.stringify({ output: 'nested result' }) }
      const result = (service as any).extractToolOutput(payload)

      expect(result).to.equal('nested result')
    })

    it('should handle empty output', () => {
      const payload = { output: '' }
      const result = (service as any).extractToolOutput(payload)

      expect(result).to.equal('')
    })

    it('should handle missing output', () => {
      const payload = {}
      const result = (service as any).extractToolOutput(payload)

      expect(result).to.equal('')
    })
  })

  describe('processResponseItem', () => {
    it('should process message type items', () => {
      const item = {
        payload: {
          content: [{ text: 'Hello', type: 'text' }],
          role: 'user',
          type: 'message'
        },
        timestamp: 1_234_567_890,
        type: 'response_item'
      }

      const result = (service as any).processResponseItem(item)

      expect(result).to.not.be.null
      expect(result.type).to.equal('user')
      expect(result.content).to.be.an('array')
    })

    it('should process custom_tool_call items', () => {
      const item = {
        payload: {
          call_id: 'tool-1',
          input: 'ls',
          name: 'bash',
          type: 'custom_tool_call'
        },
        timestamp: 1_234_567_890,
        type: 'response_item'
      }

      const result = (service as any).processResponseItem(item)

      expect(result).to.not.be.null
      expect(result.type).to.equal('assistant')
      expect(result.content[0].type).to.equal('tool_use')
    })

    it('should process reasoning items', () => {
      const item = {
        payload: {
          summary: [
            { text: 'Thinking about this...', type: 'summary_text' }
          ],
          type: 'reasoning'
        },
        timestamp: 1_234_567_890,
        type: 'response_item'
      }

      const result = (service as any).processResponseItem(item)

      expect(result).to.not.be.null
      expect(result.type).to.equal('assistant')
      expect(result.content[0].type).to.equal('thinking')
    })

    it('should return null for items with no content', () => {
      const item = {
        payload: {
          content: [],
          type: 'message'
        },
        timestamp: 1_234_567_890,
        type: 'response_item'
      }

      const result = (service as any).processResponseItem(item)

      expect(result).to.be.null
    })
  })

  // Note: isValidCodexFile method was removed from CodexCleanService
  // This validation functionality has been refactored or moved to a different layer
})
