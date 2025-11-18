/**
 * Unit tests for CursorCleanService
 * Tests transformation of Cursor raw sessions to clean Claude format
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { CursorCleanService } from '../../../../../src/infra/parsers/clean/clean-cursor-service.js'

describe('CursorCleanService', () => {
  let service: CursorCleanService
  let tempDir: string

  beforeEach(() => {
    service = new CursorCleanService('Cursor' as Agent)
    tempDir = join(tmpdir(), `test-cursor-clean-${Date.now()}`)
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
      const wsDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(wsDir, { recursive: true })

      const sessionData = {
        bubbles: [
          { text: 'Hello', timestamp: Date.now(), type: 'user' }
        ],
        id: 'session-1',
        timestamp: Date.now(),
        title: 'Test Session'
      }

      fs.writeFileSync(
        join(wsDir, 'session-1.json'),
        JSON.stringify(sessionData)
      )

      const result = await service.parse(inputDir)
      expect(result).to.be.true
    })

    it('should handle directory with no sessions', async () => {
      const inputDir = join(tempDir, 'raw')
      const wsDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(wsDir, { recursive: true })

      const result = await service.parse(inputDir)
      expect(result).to.be.true
    })

    it('should handle parse errors gracefully', async () => {
      const inputDir = join(tempDir, 'raw')
      const wsDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(wsDir, { recursive: true })

      fs.writeFileSync(join(wsDir, 'invalid.json'), 'invalid json')

      const result = await service.parse(inputDir)
      expect(result).to.be.true
    })

    it('should skip non-JSON files', async () => {
      const inputDir = join(tempDir, 'raw')
      const wsDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(wsDir, { recursive: true })

      fs.writeFileSync(join(wsDir, 'readme.txt'), 'text file')

      const result = await service.parse(inputDir)
      expect(result).to.be.true
    })
  })

  describe('transformCursorToClaudeFormat', () => {
    it('should transform bubbles to messages', () => {
      const session = {
        bubbles: [
          { text: 'Hello', timestamp: Date.now(), type: 'user' },
          { text: 'Hi there!', timestamp: Date.now(), type: 'ai' }
        ],
        id: 'session-1',
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = (service as any).transformCursorToClaudeFormat(session, 'hash')

      expect(result).to.have.property('messages')
      expect(Array.isArray(result.messages)).to.be.true
      expect(result.messages.length).to.equal(2)
    })

    it('should extract workspace paths', () => {
      const session = {
        bubbles: [],
        id: 'session-1',
        metadata: { workspacePath: '/Users/test/project' },
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = (service as any).transformCursorToClaudeFormat(session, 'hash')

      expect(result).to.have.property('workspacePaths')
      expect(Array.isArray(result.workspacePaths)).to.be.true
    })

    it('should include workspace hash in result', () => {
      const session = {
        bubbles: [],
        id: 'session-1',
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = (service as any).transformCursorToClaudeFormat(session, 'workspace-hash')

      expect(result.workspaceHash).to.equal('workspace-hash')
    })
  })

  describe('transformCursorBubbleToClaudeMessage', () => {
    it('should transform user bubble to user message', () => {
      const bubble = {
        text: 'Hello world',
        timestamp: Date.now(),
        type: 'user'
      }

      const result = (service as any).transformCursorBubbleToClaudeMessage(bubble)

      expect(result.type).to.equal('user')
      expect(result.content).to.be.an('array')
      expect(result.content[0].type).to.equal('text')
      expect(result.content[0].text).to.equal('Hello world')
    })

    it('should transform ai bubble to assistant message', () => {
      const bubble = {
        text: 'I can help',
        timestamp: Date.now(),
        type: 'ai'
      }

      const result = (service as any).transformCursorBubbleToClaudeMessage(bubble)

      expect(result.type).to.equal('assistant')
      expect(result.content[0].type).to.equal('thinking')
    })

    it('should add tool results if present', () => {
      const bubble = {
        text: 'Running command',
        timestamp: Date.now(),
        toolResults: {
          name: 'bash',
          params: { command: 'ls' },
          result: { output: 'file list' },
          toolCallId: 'tool-1'
        },
        type: 'ai'
      }

      const result = (service as any).transformCursorBubbleToClaudeMessage(bubble)

      expect(result.content.length).to.be.greaterThan(1)
      expect(result.content.some((block: any) => block.type === 'tool_use')).to.be.true
    })

    it('should add code blocks if present', () => {
      const bubble = {
        codeBlocks: [
          { content: 'const x = 1;', languageId: 'javascript' }
        ],
        text: 'Here is code',
        timestamp: Date.now(),
        type: 'ai'
      }

      const result = (service as any).transformCursorBubbleToClaudeMessage(bubble)

      expect(result.content.length).to.be.greaterThan(1)
      expect(result.content.some((block: any) => block.text && block.text.includes('javascript'))).to.be.true
    })

    it('should handle bubble with no text', () => {
      const bubble = {
        timestamp: Date.now(),
        type: 'user'
      }

      const result = (service as any).transformCursorBubbleToClaudeMessage(bubble)

      expect(result.content).to.be.an('array')
    })
  })

  describe('extractCursorToolResult', () => {
    it('should extract and simplify tool result', () => {
      const toolResults = {
        name: 'bash',
        params: { command: 'ls -la' },
        result: { output: 'file list' },
        toolCallId: 'tool-1'
      }

      const result = (service as any).extractCursorToolResult(toolResults)

      expect(result).to.not.be.null
      expect(result.type).to.equal('tool_use')
      expect(result.name).to.equal('bash')
      expect(result.id).to.equal('tool-1')
    })

    it('should handle tool without result', () => {
      const toolResults = {
        name: 'bash',
        params: { command: 'ls' },
        toolCallId: 'tool-1'
      }

      const result = (service as any).extractCursorToolResult(toolResults)

      expect(result).to.not.be.null
      expect(result.type).to.equal('tool_use')
    })

    it('should return null for empty toolResults', () => {
      const result = (service as any).extractCursorToolResult(null)

      expect(result).to.be.null
    })
  })

  describe('simplifyToolInput', () => {
    it('should simplify codebase_search input', () => {
      const input = { codeResults: [], query: 'function foo' }
      const result = (service as any).simplifyToolInput('codebase_search', input)

      expect(result).to.have.property('query')
      expect(result).to.not.have.property('codeResults')
    })

    it('should simplify read_file input', () => {
      const input = { targetFile: '/path/to/file.ts' }
      const result = (service as any).simplifyToolInput('read_file', input)

      expect(result).to.have.property('targetFile')
    })

    it('should simplify write_file input', () => {
      const input = { content: 'code', targetFile: '/path/file.ts' }
      const result = (service as any).simplifyToolInput('write_file', input)

      expect(result).to.have.property('targetFile')
      expect(result).to.have.property('content')
    })

    it('should simplify run_terminal_cmd input', () => {
      const input = { command: 'npm test', timeout: 30_000 }
      const result = (service as any).simplifyToolInput('run_terminal_cmd', input)

      expect(result).to.have.property('command')
      expect(result).to.not.have.property('timeout')
    })

    it('should return all params for unknown tools', () => {
      const input = { param1: 'value1', param2: 'value2' }
      const result = (service as any).simplifyToolInput('unknown_tool', input)

      expect(result).to.deep.equal(input)
    })
  })

  describe('simplifyToolOutput', () => {
    it('should simplify codebase_search output', () => {
      const output = { codeResults: [{ file: 'test.ts' }] }
      const result = (service as any).simplifyToolOutput('codebase_search', output)

      expect(result).to.have.property('type', 'tool_result')
      expect(result).to.have.property('content')
    })

    it('should simplify read_file output', () => {
      const output = { contents: 'file content' }
      const result = (service as any).simplifyToolOutput('read_file', output)

      expect(result.type).to.equal('tool_result')
      expect(result.content).to.equal('file content')
    })

    it('should simplify run_terminal_cmd output', () => {
      const output = { output: 'command result' }
      const result = (service as any).simplifyToolOutput('run_terminal_cmd', output)

      expect(result.type).to.equal('tool_result')
      expect(result.content.output).to.equal('command result')
    })

    it('should handle file operation success', () => {
      const output = { message: 'File created', success: true }
      const result = (service as any).simplifyToolOutput('create_folder', output)

      expect(result.type).to.equal('tool_result')
      expect(result.content.success).to.be.true
    })

    it('should return null for empty output', () => {
      const result = (service as any).simplifyToolOutput('unknown_tool', null)

      expect(result).to.be.null
    })
  })

  describe('extractWorkspacePathsFromCursor', () => {
    it('should extract workspace path from metadata', () => {
      const session = {
        bubbles: [],
        metadata: { workspacePath: '/Users/test/project' }
      }

      const result = (service as any).extractWorkspacePathsFromCursor(session)

      expect(result).to.include('/Users/test/project')
    })

    it('should extract paths from tool output', () => {
      const session = {
        bubbles: [
          {
            toolResults: {
              output: '/Users/test/src/app.ts file modified'
            }
          }
        ]
      }

      const result = (service as any).extractWorkspacePathsFromCursor(session)

      expect(result).to.be.an('array')
    })

    it('should handle array workspace paths', () => {
      const session = {
        bubbles: [],
        workspacePath: ['/project1', '/project2']
      }

      const result = (service as any).extractWorkspacePathsFromCursor(session)

      expect(result).to.include('/project1')
      expect(result).to.include('/project2')
    })

    it('should return empty array if no paths found', () => {
      const session = { bubbles: [] }

      const result = (service as any).extractWorkspacePathsFromCursor(session)

      expect(result).to.be.an('array')
    })
  })

  // Note: isValidCursorSession method was removed from CursorCleanService
  // This validation functionality has been refactored or moved to a different layer

  // Note: splitAllCursorContent method was removed from CursorCleanService
  // This content splitting functionality has been refactored or moved to a different layer

  // Note: checkSessionFile method was removed from CursorCleanService
  // This file validation functionality has been refactored or moved to a different layer

  describe('addPathsFromProperty', () => {
    it('should add string path', () => {
      const s = new Set()
      ;(service as any).addPathsFromProperty('/Users/test', s)
      expect(s).to.include('/Users/test')
    })

    it('should add array paths', () => {
      const s = new Set()
      ;(service as any).addPathsFromProperty(['/path1', '/path2'], s)
      expect(s).to.include('/path1')
      expect(s).to.include('/path2')
    })

    it('should handle non-string values in arrays', () => {
      const s = new Set()
      ;(service as any).addPathsFromProperty(['/path1', 123, '/path2'], s)
      expect(s).to.include('/path1')
      expect(s).to.include('/path2')
      expect(s.size).to.equal(2)
    })
  })

  describe('extractPathsFromToolOutput', () => {
    it('should extract paths from tool output text', () => {
      const s = new Set()
      const txt = 'Modified /Users/test/project/src/app.ts'
      ;(service as any).extractPathsFromToolOutput(txt, s)
      expect(s.size).to.be.greaterThan(0)
    })

    it('should skip /tmp paths', () => {
      const s = new Set()
      const txt = 'Created /tmp/file.txt and /Users/test/project'
      ;(service as any).extractPathsFromToolOutput(txt, s)
      expect([...s].every((p: any) => !p.startsWith('/tmp'))).to.be.true
    })
  })
})
