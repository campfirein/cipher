/* eslint-disable camelcase */
import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {ContentBlock, TranscriptEntry} from '../../../../src/coding-agent-hooks/claude/schemas.js'

import {
  expandTilde,
  extractLastAssistantText,
  extractTextFromBlock,
  extractTextFromMessage,
  getLastAssistantResponse,
  isValidTranscriptPath,
  parseTranscriptAfterTimestamp,
} from '../../../../src/coding-agent-hooks/claude/transcript-parser.js'

describe('coding-agent-hooks/claude/transcript-parser', () => {
  describe('expandTilde()', () => {
    it('should expand ~ to home directory', () => {
      const result = expandTilde('~/test/path')
      expect(result).to.equal(join(homedir(), 'test/path'))
    })

    it('should return path unchanged if no tilde', () => {
      const result = expandTilde('/absolute/path')
      expect(result).to.equal('/absolute/path')
    })

    it('should only expand tilde at start of path', () => {
      const result = expandTilde('/path/with/~/tilde')
      expect(result).to.equal('/path/with/~/tilde')
    })

    it('should handle empty string', () => {
      const result = expandTilde('')
      expect(result).to.equal('')
    })

    it('should handle just tilde', () => {
      const result = expandTilde('~')
      expect(result).to.equal(homedir())
    })
  })

  describe('isValidTranscriptPath()', () => {
    it('should accept valid path in ~/.claude/', () => {
      const validPath = '~/.claude/projects/test/00893aaf.jsonl'
      expect(isValidTranscriptPath(validPath)).to.be.true
    })

    it('should accept absolute path in ~/.claude/', () => {
      const validPath = join(homedir(), '.claude', 'projects', 'test.jsonl')
      expect(isValidTranscriptPath(validPath)).to.be.true
    })

    it('should reject path outside ~/.claude/', () => {
      const invalidPath = '~/.config/other/file.jsonl'
      expect(isValidTranscriptPath(invalidPath)).to.be.false
    })

    it('should reject path traversal attempts', () => {
      const maliciousPath = '~/.claude/../../../etc/passwd'
      expect(isValidTranscriptPath(maliciousPath)).to.be.false
    })

    it('should reject non-jsonl files', () => {
      const invalidExt = '~/.claude/projects/test.json'
      expect(isValidTranscriptPath(invalidExt)).to.be.false
    })

    it('should reject non-jsonl files with similar extension', () => {
      const invalidExt = '~/.claude/projects/test.jsonl.txt'
      expect(isValidTranscriptPath(invalidExt)).to.be.false
    })

    it('should reject empty path', () => {
      expect(isValidTranscriptPath('')).to.be.false
    })

    it('should handle path with spaces', () => {
      const pathWithSpaces = '~/.claude/projects/my project/file.jsonl'
      expect(isValidTranscriptPath(pathWithSpaces)).to.be.true
    })
  })

  describe('extractTextFromBlock()', () => {
    it('should extract text from text block', () => {
      const block: ContentBlock = {text: 'Hello world', type: 'text'}
      expect(extractTextFromBlock(block)).to.equal('Hello world')
    })

    it('should return undefined for thinking block', () => {
      const block: ContentBlock = {thinking: 'Internal thoughts', type: 'thinking'}
      expect(extractTextFromBlock(block)).to.be.undefined
    })

    it('should return undefined for tool_use block', () => {
      const block: ContentBlock = {
        id: 'tool-123',
        input: {path: '/test'},
        name: 'read_file',
        type: 'tool_use',
      }
      expect(extractTextFromBlock(block)).to.be.undefined
    })

    it('should return undefined for tool_result block', () => {
      const block: ContentBlock = {
        content: 'result content',
        tool_use_id: 'tool-123',
        type: 'tool_result',
      }
      expect(extractTextFromBlock(block)).to.be.undefined
    })

    it('should handle string directly', () => {
      expect(extractTextFromBlock('direct string')).to.equal('direct string')
    })

    it('should handle empty text', () => {
      const block: ContentBlock = {text: '', type: 'text'}
      expect(extractTextFromBlock(block)).to.equal('')
    })
  })

  describe('extractTextFromMessage()', () => {
    it('should extract text from assistant message with string content', () => {
      const entry: TranscriptEntry = {
        message: {
          content: 'Hello from assistant',
          role: 'assistant',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'assistant',
      }
      expect(extractTextFromMessage(entry)).to.equal('Hello from assistant')
    })

    it('should extract text from assistant message with array content', () => {
      const entry: TranscriptEntry = {
        message: {
          content: [
            {text: 'First part', type: 'text'},
            {thinking: 'Some thinking', type: 'thinking'},
            {text: 'Second part', type: 'text'},
          ],
          role: 'assistant',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'assistant',
      }
      expect(extractTextFromMessage(entry)).to.equal('First part\nSecond part')
    })

    it('should return undefined for user message', () => {
      const entry: TranscriptEntry = {
        message: {
          content: 'User message',
          role: 'user',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'user',
      }
      expect(extractTextFromMessage(entry)).to.be.undefined
    })

    it('should return undefined for system message', () => {
      const entry: TranscriptEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'system',
      }
      expect(extractTextFromMessage(entry)).to.be.undefined
    })

    it('should return undefined for message without content', () => {
      const entry: TranscriptEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'assistant',
      }
      expect(extractTextFromMessage(entry)).to.be.undefined
    })

    it('should return undefined for array with no text blocks', () => {
      const entry: TranscriptEntry = {
        message: {
          content: [
            {thinking: 'Only thinking', type: 'thinking'},
            {
              id: 'tool-1',
              input: {},
              name: 'test',
              type: 'tool_use',
            },
          ],
          role: 'assistant',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'assistant',
      }
      expect(extractTextFromMessage(entry)).to.be.undefined
    })
  })

  describe('extractLastAssistantText()', () => {
    it('should extract last assistant text from entries', () => {
      const entries: TranscriptEntry[] = [
        {
          message: {content: 'First response', role: 'assistant'},
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'assistant',
        },
        {
          message: {content: 'User message', role: 'user'},
          timestamp: '2024-01-01T00:00:01.000Z',
          type: 'user',
        },
        {
          message: {content: 'Last response', role: 'assistant'},
          timestamp: '2024-01-01T00:00:02.000Z',
          type: 'assistant',
        },
      ]
      expect(extractLastAssistantText(entries)).to.equal('Last response')
    })

    it('should return undefined for empty array', () => {
      expect(extractLastAssistantText([])).to.be.undefined
    })

    it('should return undefined when no assistant text', () => {
      const entries: TranscriptEntry[] = [
        {
          message: {content: 'User only', role: 'user'},
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'user',
        },
      ]
      expect(extractLastAssistantText(entries)).to.be.undefined
    })

    it('should skip assistant entries without text content', () => {
      const entries: TranscriptEntry[] = [
        {
          message: {content: 'Has text', role: 'assistant'},
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'assistant',
        },
        {
          message: {
            content: [{thinking: 'Only thinking', type: 'thinking'}],
            role: 'assistant',
          },
          timestamp: '2024-01-01T00:00:01.000Z',
          type: 'assistant',
        },
      ]
      expect(extractLastAssistantText(entries)).to.equal('Has text')
    })
  })

  describe('parseTranscriptAfterTimestamp()', () => {
    const testClaudeDir = join(homedir(), '.claude', 'test-transcript-parser')

    before(() => {
      if (!existsSync(testClaudeDir)) {
        mkdirSync(testClaudeDir, {recursive: true})
      }
    })

    after(() => {
      if (existsSync(testClaudeDir)) {
        rmSync(testClaudeDir, {force: true, recursive: true})
      }
    })

    it('should parse valid JSONL file', async () => {
      const testFile = join(testClaudeDir, 'valid.jsonl')
      const timestamp = Date.now() - 10_000 // 10 seconds ago
      const entries = [
        JSON.stringify({
          message: {content: 'After timestamp', role: 'assistant'},
          timestamp: new Date(timestamp + 5000).toISOString(),
          type: 'assistant',
        }),
        JSON.stringify({
          message: {content: 'User msg', role: 'user'},
          timestamp: new Date(timestamp + 6000).toISOString(),
          type: 'user',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await parseTranscriptAfterTimestamp(testFile, timestamp)
      expect(result).to.have.lengthOf(2)
      expect(result[0].type).to.equal('assistant')
    })

    it('should filter entries before timestamp', async () => {
      const testFile = join(testClaudeDir, 'filter.jsonl')
      const timestamp = Date.now()
      const entries = [
        JSON.stringify({
          message: {content: 'Before - should be filtered', role: 'assistant'},
          timestamp: new Date(timestamp - 5000).toISOString(),
          type: 'assistant',
        }),
        JSON.stringify({
          message: {content: 'After - should be included', role: 'assistant'},
          timestamp: new Date(timestamp + 5000).toISOString(),
          type: 'assistant',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await parseTranscriptAfterTimestamp(testFile, timestamp)
      expect(result).to.have.lengthOf(1)
    })

    it('should include entries at exact timestamp (fixed bug)', async () => {
      const testFile = join(testClaudeDir, 'exact.jsonl')
      const timestamp = Date.now()
      const entries = [
        JSON.stringify({
          message: {content: 'At exact timestamp', role: 'assistant'},
          timestamp: new Date(timestamp).toISOString(),
          type: 'assistant',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await parseTranscriptAfterTimestamp(testFile, timestamp)
      expect(result).to.have.lengthOf(1)
    })

    it('should return empty array for file not found', async () => {
      const nonExistent = join(testClaudeDir, 'nonexistent.jsonl')
      const result = await parseTranscriptAfterTimestamp(nonExistent, Date.now())
      expect(result).to.deep.equal([])
    })

    it('should return empty array for invalid path', async () => {
      const invalidPath = '/tmp/outside-claude.jsonl'
      const result = await parseTranscriptAfterTimestamp(invalidPath, Date.now())
      expect(result).to.deep.equal([])
    })

    it('should skip malformed JSON lines', async () => {
      const testFile = join(testClaudeDir, 'malformed.jsonl')
      const timestamp = Date.now() - 10_000
      const entries = [
        'not valid json',
        JSON.stringify({
          message: {content: 'Valid entry', role: 'assistant'},
          timestamp: new Date(timestamp + 5000).toISOString(),
          type: 'assistant',
        }),
        '{incomplete json',
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await parseTranscriptAfterTimestamp(testFile, timestamp)
      expect(result).to.have.lengthOf(1)
    })

    it('should skip entries without timestamp', async () => {
      const testFile = join(testClaudeDir, 'no-timestamp.jsonl')
      const entries = [
        JSON.stringify({
          message: {content: 'No timestamp', role: 'assistant'},
          type: 'assistant',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await parseTranscriptAfterTimestamp(testFile, 0)
      expect(result).to.deep.equal([])
    })

    it('should handle empty file', async () => {
      const testFile = join(testClaudeDir, 'empty.jsonl')
      writeFileSync(testFile, '')

      const result = await parseTranscriptAfterTimestamp(testFile, Date.now())
      expect(result).to.deep.equal([])
    })
  })

  describe('getLastAssistantResponse()', () => {
    const testClaudeDir = join(homedir(), '.claude', 'test-transcript-parser-combined')

    before(() => {
      if (!existsSync(testClaudeDir)) {
        mkdirSync(testClaudeDir, {recursive: true})
      }
    })

    after(() => {
      if (existsSync(testClaudeDir)) {
        rmSync(testClaudeDir, {force: true, recursive: true})
      }
    })

    it('should return last assistant text from transcript', async () => {
      const testFile = join(testClaudeDir, 'combined.jsonl')
      const timestamp = Date.now() - 10_000
      const entries = [
        JSON.stringify({
          message: {content: 'First response', role: 'assistant'},
          timestamp: new Date(timestamp + 1000).toISOString(),
          type: 'assistant',
        }),
        JSON.stringify({
          message: {content: 'Last response', role: 'assistant'},
          timestamp: new Date(timestamp + 5000).toISOString(),
          type: 'assistant',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await getLastAssistantResponse(testFile, timestamp)
      expect(result).to.equal('Last response')
    })

    it('should return undefined when no assistant responses', async () => {
      const testFile = join(testClaudeDir, 'no-assistant.jsonl')
      const timestamp = Date.now() - 10_000
      const entries = [
        JSON.stringify({
          message: {content: 'User only', role: 'user'},
          timestamp: new Date(timestamp + 5000).toISOString(),
          type: 'user',
        }),
      ]
      writeFileSync(testFile, entries.join('\n'))

      const result = await getLastAssistantResponse(testFile, timestamp)
      expect(result).to.be.undefined
    })

    it('should return undefined for nonexistent file', async () => {
      const result = await getLastAssistantResponse(
        join(testClaudeDir, 'nonexistent.jsonl'),
        Date.now(),
      )
      expect(result).to.be.undefined
    })
  })
})
