/**
 * Unit tests for shared parser utilities
 * Tests all transformation functions used by clean parsers
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'

import {
  addTurnIds,
  combineToolResults,
  extractWorkspacePaths,
  normalizeClaudeSession,
  normalizeContent,
  normalizeContentBlock
} from '../../../../../src/server/infra/parsers/clean/shared.js'

describe('Shared Parser Utilities', () => {
  describe('normalizeContent', () => {
    it('should normalize array of blocks', () => {
      const content = [
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' }
      ]

      const result = normalizeContent(content)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(2)
    })

    it('should convert string to text block', () => {
      const result = normalizeContent('Hello world')

      expect(result).to.be.an('array')
      expect(result.length).to.equal(1)
      expect(result[0].type).to.equal('text')
      expect((result[0] as any).text).to.equal('Hello world')
    })

    it('should wrap object as single block', () => {
      const content = { text: 'Content', type: 'text' }

      const result = normalizeContent(content)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(1)
    })

    it('should return empty array for null', () => {
      const result = normalizeContent(null)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(0)
    })

    it('should return empty array for undefined', () => {
      /* eslint-disable-next-line unicorn/no-useless-undefined */
      const result = normalizeContent(undefined)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(0)
    })

    it('should normalize mixed content', () => {
      const content = [
        'text string',
        { thinking: 'thoughts', type: 'thinking' }
      ]

      const result = normalizeContent(content)

      expect(result).to.be.an('array')
      expect(result.length).to.equal(2)
    })
  })

  describe('normalizeContentBlock', () => {
    it('should normalize string block', () => {
      const result = normalizeContentBlock('Hello')

      expect(result.type).to.equal('text')
      expect((result as any).text).to.equal('Hello')
    })

    it('should preserve existing type', () => {
      const block = { thinking: 'thoughts', type: 'thinking' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('thinking')
      expect((result as any).thinking).to.equal('thoughts')
    })

    it('should infer text type from text property', () => {
      const block = { text: 'content' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('text')
      expect((result as any).text).to.equal('content')
    })

    it('should infer thinking type from thinking property', () => {
      const block = { thinking: 'internal monologue' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('thinking')
      expect((result as any).thinking).to.equal('internal monologue')
    })

    it('should infer tool_use type from name and input', () => {
      const block = { input: { command: 'ls' }, name: 'bash' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('tool_use')
    })

    it('should infer tool_result type from tool_use_id', () => {
      /* eslint-disable-next-line camelcase */
      const block = { content: 'result', tool_use_id: 'tool-1' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('tool_result')
    })

    it('should default to text type if no hints found', () => {
      const block = { unknown: 'field' }

      const result = normalizeContentBlock(block)

      expect(result.type).to.equal('text')
    })

    it('should remove signature property', () => {
      const block = { signature: 'should be removed', text: 'content', type: 'text' }

      const result = normalizeContentBlock(block)

      expect(result).to.not.have.property('signature')
    })

    it('should handle non-string, non-object values', () => {
      const result = normalizeContentBlock(123)

      expect(result.type).to.equal('text')
      expect((result as any).text).to.equal('123')
    })

    it('should handle null gracefully', () => {
      const result = normalizeContentBlock(null)

      expect(result.type).to.equal('text')
    })
  })

  describe('combineToolResults', () => {
    it('should combine tool_use with matching tool_result', () => {
      /* eslint-disable camelcase */
      const messages = [
        {
          content: [
            { id: 'tool-1', input: {}, name: 'bash', tool_use_id: 'tool-1', type: 'tool_use' as const }
          ],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        },
        {
          content: [
            { content: 'output', tool_use_id: 'tool-1', type: 'tool_result' as const }
          ],
          timestamp: '2024-01-01T10:01:00Z',
          type: 'assistant' as const
        }
      ]
      /* eslint-enable camelcase */

      const result = combineToolResults(messages)

      expect(result).to.be.an('array')
      expect(result[0].content[0]).to.have.property('output')
    })

    it('should not combine tool_use without matching result', () => {
      /* eslint-disable camelcase */
      const messages = [
        {
          content: [
            { id: 'tool-1', input: {}, name: 'bash', tool_use_id: 'tool-1', type: 'tool_use' as const }
          ],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        }
      ]
      /* eslint-enable camelcase */

      const result = combineToolResults(messages)

      expect(result[0].content[0].type).to.equal('tool_use')
    })

    it('should skip tool_result blocks after combining', () => {
      /* eslint-disable camelcase */
      const messages = [
        {
          content: [
            { id: 'tool-1', input: {}, name: 'bash', tool_use_id: 'tool-1', type: 'tool_use' as const }
          ],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        },
        {
          content: [
            { content: 'output', tool_use_id: 'tool-1', type: 'tool_result' as const }
          ],
          timestamp: '2024-01-01T10:01:00Z',
          type: 'assistant' as const
        }
      ]
      /* eslint-enable camelcase */

      const result = combineToolResults(messages)

      /* eslint-disable-next-line max-nested-callbacks */
      const hasToolResult = result.some((msg: any) => msg.content.some((block: any) => block.type === 'tool_result'))
      expect(hasToolResult).to.be.false
    })

    it('should handle messages with empty content', () => {
      const messages = [
        {
          content: [],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        }
      ]

      const result = combineToolResults(messages)

      expect(result).to.be.an('array')
    })

    it('should preserve non-tool content', () => {
      const messages = [
        {
          content: [{ text: 'hello', type: 'text' as const }],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'user' as const
        }
      ]

      const result = combineToolResults(messages)

      expect(result[0].content[0].type).to.equal('text')
    })

    it('should handle multiple tool calls', () => {
      /* eslint-disable camelcase */
      const messages = [
        {
          content: [
            { id: 'tool-1', input: {}, name: 'bash', tool_use_id: 'tool-1', type: 'tool_use' as const },
            { id: 'tool-2', input: {}, name: 'grep', tool_use_id: 'tool-2', type: 'tool_use' as const }
          ],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        },
        {
          content: [
            { content: 'output1', tool_use_id: 'tool-1', type: 'tool_result' as const },
            { content: 'output2', tool_use_id: 'tool-2', type: 'tool_result' as const }
          ],
          timestamp: '2024-01-01T10:01:00Z',
          type: 'assistant' as const
        }
      ]
      /* eslint-enable camelcase */

      const result = combineToolResults(messages)
      const firstContent = result[0].content[0] as Record<string, unknown>
      const secondContent = result[0].content[1] as Record<string, unknown>

      expect(result[0].content.length).to.equal(2)
      expect(firstContent).to.have.property('output')
      expect(secondContent).to.have.property('output')
    })
  })

  describe('addTurnIds', () => {
    it('should add sequential turn_id to messages', () => {
      const messages = [
        { content: [], timestamp: '2024-01-01T10:00:00Z', type: 'user' as const },
        { content: [], timestamp: '2024-01-01T10:01:00Z', type: 'assistant' as const }
      ]

      const result = addTurnIds(messages)

      expect(result[0]).to.have.property('turn_id', 1)
      expect(result[1]).to.have.property('turn_id', 2)
    })

    it('should preserve other message properties', () => {
      const messages = [
        {
          content: [{ text: 'hello', type: 'text' as const }],
          timestamp: '2024-01-01T10:00:00Z',
          type: 'user' as const
        }
      ]

      const result = addTurnIds(messages)

      expect(result[0].type).to.equal('user')
      expect(result[0].timestamp).to.equal('2024-01-01T10:00:00Z')
      expect(result[0].content).to.be.an('array')
    })

    it('should handle empty message array', () => {
      const result = addTurnIds([])

      expect(result).to.be.an('array')
      expect(result.length).to.equal(0)
    })

    it('should handle single message', () => {
      const messages = [
        { content: [], timestamp: '2024-01-01T10:00:00Z', type: 'user' as const }
      ]

      const result = addTurnIds(messages)

      expect(result[0].turn_id).to.equal(1)
    })

    it('should maintain turn_id sequence for large arrays', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        content: [],
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        type: i % 2 === 0 ? ('user' as const) : ('assistant' as const)
      }))

      const result = addTurnIds(messages)

      for (const [i, element] of result.entries()) {
        expect(element.turn_id).to.equal(i + 1)
      }
    })
  })

  describe('extractWorkspacePaths', () => {
    it('should extract paths from existing array', () => {
      const paths = extractWorkspacePaths([], undefined, ['/path1', '/path2'])

      expect(paths).to.include('/path1')
      expect(paths).to.include('/path2')
    })

    it('should extract cwd from messages', () => {
      const messages = [
        {
          content: [],
          cwd: '/Users/test/project',
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        } as any
      ]

      const paths = extractWorkspacePaths(messages, undefined, [])

      expect(paths).to.include('/Users/test/project')
    })

    it('should extract cwd from metadata', () => {
      const metadata = { cwd: '/workspace/path' }

      const paths = extractWorkspacePaths([], metadata, [])

      expect(paths).to.include('/workspace/path')
    })

    it('should combine all paths and remove duplicates', () => {
      const messages = [
        {
          content: [],
          cwd: '/path1',
          timestamp: '2024-01-01T10:00:00Z',
          type: 'user' as const
        } as any
      ]

      const metadata = { cwd: '/path2' }
      const existing = ['/path1']

      const paths = extractWorkspacePaths(messages, metadata, existing)

      expect(paths).to.include('/path1')
      expect(paths).to.include('/path2')
      expect(paths.filter(p => p === '/path1').length).to.equal(1)
    })

    it('should sort paths', () => {
      const paths = extractWorkspacePaths([], undefined, ['/z/path', '/a/path', '/m/path'])

      expect(paths[0]).to.equal('/a/path')
      expect(paths.at(-1)).to.equal('/z/path')
    })

    it('should handle undefined metadata', () => {
      const paths = extractWorkspacePaths([], undefined, [])

      expect(paths).to.be.an('array')
    })

    it('should filter out non-string paths', () => {
      const messages = [
        {
          content: [],
          cwd: 123,
          timestamp: '2024-01-01T10:00:00Z',
          type: 'assistant' as const
        } as any
      ]

      const paths = extractWorkspacePaths(messages, undefined, [])

      expect(paths).to.not.include(123)
    })
  })

  describe('normalizeClaudeSession', () => {
    it('should normalize complete session', () => {
      const session = {
        id: 'session-1',
        messages: [
          {
            content: 'Hello',
            timestamp: '2024-01-01T10:00:00Z',
            type: 'user'
          }
        ],
        timestamp: 1_234_567_890,
        title: 'Test Session'
      }

      const result = normalizeClaudeSession(session)

      expect(result).to.have.property('id', 'session-1')
      expect(result).to.have.property('title', 'Test Session')
      expect(result).to.have.property('messages')
      expect(Array.isArray(result.messages)).to.be.true
    })

    it('should normalize message content to array', () => {
      const session = {
        id: 'test',
        messages: [
          {
            content: 'String content',
            timestamp: '2024-01-01T10:00:00Z',
            type: 'user'
          }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.messages[0].content).to.be.an('array')
    })

    it('should add turn_id to messages', () => {
      const session = {
        id: 'test',
        messages: [
          { content: [{ text: 'hello', type: 'text' }], timestamp: '2024-01-01T10:00:00Z', type: 'user' },
          { content: [{ thinking: 'thinking', type: 'thinking' }], timestamp: '2024-01-01T10:01:00Z', type: 'assistant' }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.messages.length).to.equal(2)
      expect(result.messages[0].turn_id).to.equal(1)
      expect(result.messages[1].turn_id).to.equal(2)
    })

    it('should preserve custom session type', () => {
      const session = {
        id: 'test',
        messages: [],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session, 'Cursor')

      expect(result.type).to.equal('Cursor')
    })

    it('should default to Claude session type', () => {
      const session = {
        id: 'test',
        messages: [],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.type).to.equal('Claude')
    })

    it('should extract workspace paths', () => {
      const session = {
        id: 'test',
        messages: [],
        timestamp: Date.now(),
        title: 'Test',
        workspacePaths: ['/Users/test/project']
      }

      const result = normalizeClaudeSession(session)

      expect(result.workspacePaths).to.include('/Users/test/project')
    })

    it('should combine tool_use with tool_result', () => {
      /* eslint-disable camelcase */
      const session = {
        id: 'test',
        messages: [
          {
            content: [
              { id: 'tool-1', input: {}, name: 'bash', tool_use_id: 'tool-1', type: 'tool_use' }
            ],
            timestamp: '2024-01-01T10:00:00Z',
            type: 'assistant'
          },
          {
            content: [
              { content: 'output', tool_use_id: 'tool-1', type: 'tool_result' }
            ],
            timestamp: '2024-01-01T10:01:00Z',
            type: 'assistant'
          }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }
      /* eslint-enable camelcase */

      const result = normalizeClaudeSession(session)

      // First message should have combined tool with output
      expect(result.messages[0].content[0]).to.have.property('output')
    })

    it('should handle messages without timestamp', () => {
      const session = {
        id: 'test',
        messages: [
          {
            content: 'Hello',
            type: 'user'
          }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.messages[0]).to.have.property('timestamp')
      expect(typeof result.messages[0].timestamp).to.equal('string')
    })

    it('should preserve additional message properties', () => {
      const session = {
        id: 'test',
        messages: [
          {
            content: 'Hello',
            customField: 'custom value',
            timestamp: '2024-01-01T10:00:00Z',
            type: 'user'
          }
        ],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect((result.messages[0] as any).customField).to.equal('custom value')
    })

    it('should handle empty messages array', () => {
      const session = {
        id: 'test',
        messages: [],
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.messages).to.be.an('array')
      expect(result.messages.length).to.equal(0)
    })

    it('should handle session with metadata', () => {
      const session = {
        id: 'test',
        messages: [],
        metadata: { custom: 'metadata' },
        timestamp: Date.now(),
        title: 'Test'
      }

      const result = normalizeClaudeSession(session)

      expect(result.metadata).to.deep.equal({ custom: 'metadata' })
    })
  })
})
