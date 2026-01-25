/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {Message, MessageParam} from '@anthropic-ai/sdk/resources/messages'

import {expect} from 'chai'

import type {InternalMessage} from '../../../../../src/agent/interfaces/message-types.js'

import {ClaudeMessageFormatter} from '../../../../../src/agent/llm/formatters/claude-formatter.js'

describe('ClaudeMessageFormatter', () => {
  let formatter: ClaudeMessageFormatter

  beforeEach(() => {
    formatter = new ClaudeMessageFormatter()
  })

  describe('format', () => {
    describe('basic message formatting', () => {
      it('should format simple user message', () => {
        const history: InternalMessage[] = [
          {
            content: 'Hello, Claude!',
            role: 'user',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]).to.deep.equal({
          content: 'Hello, Claude!',
          role: 'user',
        })
      })

      it('should format simple assistant message', () => {
        const history: InternalMessage[] = [
          {
            content: 'Hello! How can I help you?',
            role: 'assistant',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.role).to.equal('assistant')
        expect(result[0]?.content).to.be.an('array')
        const content = result[0]?.content as Array<{text: string; type: string;}>
        expect(content[0]?.type).to.equal('text')
        expect(content[0]?.text).to.equal('Hello! How can I help you?')
      })

      it('should format conversation with multiple messages', () => {
        const history: InternalMessage[] = [
          {content: 'Hi', role: 'user'},
          {content: 'Hello!', role: 'assistant'},
          {content: 'How are you?', role: 'user'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(3)
        expect(result[0]?.role).to.equal('user')
        expect(result[1]?.role).to.equal('assistant')
        expect(result[2]?.role).to.equal('user')
      })
    })

    describe('system message handling', () => {
      it('should skip system messages', () => {
        const history: InternalMessage[] = [
          {content: 'You are a helpful assistant', role: 'system'},
          {content: 'Hello', role: 'user'},
        ]

        const result = formatter.format(history)

        // System message should be filtered out
        expect(result).to.have.lengthOf(1)
        expect(result[0]?.role).to.equal('user')
      })

      it('should ignore system prompt parameter', () => {
        const history: InternalMessage[] = [
          {content: 'Hello', role: 'user'},
        ]

        const result = formatter.format(history, 'System prompt here')

        // System prompt is not added to messages
        expect(result).to.have.lengthOf(1)
        expect(result[0]?.role).to.equal('user')
      })

      it('should skip multiple system messages', () => {
        const history: InternalMessage[] = [
          {content: 'System 1', role: 'system'},
          {content: 'Hello', role: 'user'},
          {content: 'System 2', role: 'system'},
          {content: 'Response', role: 'assistant'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(2)
        expect(result[0]?.role).to.equal('user')
        expect(result[1]?.role).to.equal('assistant')
      })
    })

    describe('tool call formatting', () => {
      it('should format assistant message with tool call', () => {
        const history: InternalMessage[] = [
          {
            content: 'Let me search for that',
            role: 'assistant',
            toolCalls: [
              {
                function: {
                  arguments: '{"query": "test"}',
                  name: 'search',
                },
                id: 'call_123',
                type: 'function',
              },
            ],
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        const msg = result[0] as MessageParam
        expect(msg.role).to.equal('assistant')
        expect(msg.content).to.be.an('array')

        const content = msg.content as Array<{type: string}>
        expect(content).to.have.lengthOf(2)

        // First block should be text
        expect(content[0]?.type).to.equal('text')

        // Second block should be tool_use
        const toolUse = content[1] as {id: string; input: unknown; name: string; type: string;}
        expect(toolUse.type).to.equal('tool_use')
        expect(toolUse.id).to.equal('call_123')
        expect(toolUse.name).to.equal('search')
        expect(toolUse.input).to.deep.equal({query: 'test'})
      })

      it('should format assistant message with multiple tool calls', () => {
        const history: InternalMessage[] = [
          {
            content: 'Running multiple searches',
            role: 'assistant',
            toolCalls: [
              {
                function: {
                  arguments: '{"query": "test1"}',
                  name: 'search',
                },
                id: 'call_1',
                type: 'function',
              },
              {
                function: {
                  arguments: '{"query": "test2"}',
                  name: 'search',
                },
                id: 'call_2',
                type: 'function',
              },
            ],
          },
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{id?: string; type: string;}>
        expect(content).to.have.lengthOf(3) // 1 text + 2 tool_use blocks

        expect(content[1]?.id).to.equal('call_1')
        expect(content[2]?.id).to.equal('call_2')
      })

      it('should format assistant message with tool call but no text', () => {
        const history: InternalMessage[] = [
          {
            content: null,
            role: 'assistant',
            toolCalls: [
              {
                function: {
                  arguments: '{"value": 42}',
                  name: 'calculate',
                },
                id: 'call_999',
                type: 'function',
              },
            ],
          },
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{type: string}>
        // Should not include empty text block, only tool_use
        expect(content).to.have.lengthOf(1)
        expect(content[0]?.type).to.equal('tool_use')
      })
    })

    describe('tool result formatting', () => {
      it('should format tool result message', () => {
        const history: InternalMessage[] = [
          {
            content: 'Search results: Found 5 items',
            role: 'tool',
            toolCallId: 'call_123',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        const msg = result[0] as MessageParam
        expect(msg.role).to.equal('user') // Tool results sent as user messages

        const content = msg.content as Array<{content: string; tool_use_id: string; type: string;}>
        expect(content).to.have.lengthOf(1)
        expect(content[0]?.type).to.equal('tool_result')
        expect(content[0]?.tool_use_id).to.equal('call_123')
        expect(content[0]?.content).to.equal('Search results: Found 5 items')
      })

      it('should handle tool result with null content', () => {
        const history: InternalMessage[] = [
          {
            content: null,
            role: 'tool',
            toolCallId: 'call_456',
          },
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{content: string}>
        expect(content[0]?.content).to.equal('') // null converted to empty string
      })

      it('should handle tool result with undefined toolCallId', () => {
        const history: InternalMessage[] = [
          {
            content: 'Result',
            role: 'tool',
            toolCallId: undefined,
          },
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{tool_use_id: string}>
        expect(content[0]?.tool_use_id).to.equal('') // undefined converted to empty string
      })
    })

    describe('multimodal content formatting', () => {
      it('should format user message with text parts', () => {
        const history: InternalMessage[] = [
          {
            content: [
              {text: 'First part', type: 'text'},
              {text: 'Second part', type: 'text'},
            ],
            role: 'user',
          },
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{text: string; type: string;}>
        expect(content).to.have.lengthOf(2)
        expect(content[0]?.type).to.equal('text')
        expect(content[0]?.text).to.equal('First part')
        expect(content[1]?.text).to.equal('Second part')
      })

      it('should handle image parts with placeholder', () => {
        const history = [
          {
            content: [
              {text: 'Look at this image:', type: 'text'},
              {image: {data: 'base64data', mimeType: 'image/png'}, type: 'image'},
            ],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{text: string; type: string;}>
        expect(content).to.have.lengthOf(2)
        expect(content[0]?.text).to.equal('Look at this image:')
        // Image support not yet implemented, shows placeholder
        expect(content[1]?.text).to.equal('[Image not yet supported]')
      })

      it('should handle file parts with placeholder', () => {
        const history = [
          {
            content: [
              {file: {mimeType: 'text/plain', name: 'test.txt'}, type: 'file'},
            ],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{text: string}>
        expect(content[0]?.text).to.equal('[File not yet supported]')
      })

      it('should handle unknown content type', () => {
        const history = [
          {
            content: [{type: 'unknown_type' as 'text'}],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as Array<{text: string}>
        expect(content[0]?.text).to.equal('[Unknown content type]')
      })
    })

    describe('edge cases', () => {
      it('should handle empty history', () => {
        const result = formatter.format([])
        expect(result).to.have.lengthOf(0)
      })

      it('should handle user message with empty string content', () => {
        const history: InternalMessage[] = [
          {content: '', role: 'user'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal('')
      })

      it('should handle user message with null content', () => {
        const history: InternalMessage[] = [
          {content: null, role: 'user'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal('')
      })

      it('should handle user message with empty array content', () => {
        const history: InternalMessage[] = [
          {content: [], role: 'user'},
        ]

        const result = formatter.format(history)

        const msg = result[0] as MessageParam
        const content = msg.content as unknown[]
        expect(content).to.have.lengthOf(0)
      })

      it('should preserve message order', () => {
        const history: InternalMessage[] = [
          {content: 'Message 1', role: 'user'},
          {content: 'Message 2', role: 'assistant'},
          {content: 'Message 3', role: 'user'},
          {content: 'Message 4', role: 'assistant'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(4)
        const userMsg1 = result[0] as {content: string}
        const assistantMsg1 = result[1] as {content: Array<{text: string}>}
        const userMsg2 = result[2] as {content: string}
        const assistantMsg2 = result[3] as {content: Array<{text: string}>}

        expect(userMsg1.content).to.equal('Message 1')
        expect(assistantMsg1.content[0]?.text).to.equal('Message 2')
        expect(userMsg2.content).to.equal('Message 3')
        expect(assistantMsg2.content[0]?.text).to.equal('Message 4')
      })
    })
  })

  describe('parseResponse', () => {
    describe('basic response parsing', () => {
      it('should parse text-only response', () => {
        const claudeResponse = {
          content: [
            {
              text: 'Hello! How can I help you?',
              type: 'text',
            },
          ],
          id: 'msg_123',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 10, output_tokens: 20},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.role).to.equal('assistant')
        expect(result[0]?.content).to.equal('Hello! How can I help you?')
        expect(result[0]?.toolCalls).to.be.undefined
      })

      it('should parse response with multiple text blocks', () => {
        const claudeResponse = {
          content: [
            {text: 'First part. ', type: 'text'},
            {text: 'Second part.', type: 'text'},
          ],
          id: 'msg_456',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 10, output_tokens: 30},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(1)
        // Text parts should be concatenated
        expect(result[0]?.content).to.equal('First part. Second part.')
      })

      it('should parse response with empty content array', () => {
        const claudeResponse = {
          content: [],
          id: 'msg_789',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 10, output_tokens: 0},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(0)
      })
    })

    describe('tool use response parsing', () => {
      it('should parse response with single tool use', () => {
        const claudeResponse = {
          content: [
            {
              text: 'Let me search for that.',
              type: 'text',
            },
            {
              id: 'toolu_123',
              input: {query: 'test query'},
              name: 'search',
              type: 'tool_use',
            },
          ],
          id: 'msg_tool1',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 100, output_tokens: 50},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal('Let me search for that.')
        expect(result[0]?.toolCalls).to.exist
        expect(result[0]?.toolCalls).to.have.lengthOf(1)

        const toolCall = result[0]?.toolCalls?.[0]
        expect(toolCall?.id).to.equal('toolu_123')
        expect(toolCall?.type).to.equal('function')
        expect(toolCall?.function.name).to.equal('search')
        expect(toolCall?.function.arguments).to.equal('{"query":"test query"}')
      })

      it('should parse response with multiple tool uses', () => {
        const claudeResponse = {
          content: [
            {
              id: 'toolu_1',
              input: {query: 'first'},
              name: 'search',
              type: 'tool_use',
            },
            {
              id: 'toolu_2',
              input: {query: 'second'},
              name: 'search',
              type: 'tool_use',
            },
          ],
          id: 'msg_tool2',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 100, output_tokens: 100},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result[0]?.toolCalls).to.have.lengthOf(2)
        expect(result[0]?.toolCalls?.[0]?.id).to.equal('toolu_1')
        expect(result[0]?.toolCalls?.[1]?.id).to.equal('toolu_2')
      })

      it('should parse response with tool use but no text', () => {
        const claudeResponse = {
          content: [
            {
              id: 'toolu_only',
              input: {param: 'value'},
              name: 'my_tool',
              type: 'tool_use',
            },
          ],
          id: 'msg_tool3',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 50, output_tokens: 30},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result[0]?.content).to.equal(null) // Empty text becomes null
        expect(result[0]?.toolCalls).to.have.lengthOf(1)
      })

      it('should parse tool use with complex input', () => {
        const claudeResponse = {
          content: [
            {
              id: 'toolu_complex',
              input: {
                array: [1, 2, 3],
                nested: {deep: {value: 'test'}},
                number: 42,
                string: 'hello',
              },
              name: 'complex_tool',
              type: 'tool_use',
            },
          ],
          id: 'msg_complex',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 100, output_tokens: 80},
        }

        const result = formatter.parseResponse(claudeResponse)

        const toolCall = result[0]?.toolCalls?.[0]
        const parsedArgs = JSON.parse(toolCall?.function.arguments ?? '{}')
        expect(parsedArgs).to.deep.equal({
          array: [1, 2, 3],
          nested: {deep: {value: 'test'}},
          number: 42,
          string: 'hello',
        })
      })
    })

    describe('mixed content response parsing', () => {
      it('should parse response with text and tool use mixed', () => {
        const claudeResponse = {
          content: [
            {text: 'First, ', type: 'text'},
            {
              id: 'tool_mid',
              input: {action: 'search'},
              name: 'tool',
              type: 'tool_use',
            },
            {text: ' then done.', type: 'text'},
          ],
          id: 'msg_mixed',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 50, output_tokens: 70},
        }

        const result = formatter.parseResponse(claudeResponse)

        // Text parts should be concatenated
        expect(result[0]?.content).to.equal('First,  then done.')
        expect(result[0]?.toolCalls).to.have.lengthOf(1)
      })
    })

    describe('edge cases', () => {
      it('should handle response with no content blocks', () => {
        const claudeResponse = {
          content: [],
          id: 'msg_empty',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          type: 'message',
        }

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(0)
      })

      it('should handle response with empty text', () => {
        const claudeResponse = {
          content: [
            {text: '', type: 'text'},
          ],
          id: 'msg_empty_text',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: {input_tokens: 10, output_tokens: 0},
        } as any as Message

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal(null) // Empty string becomes null
      })

      it('should ignore unknown content block types', () => {
        const claudeResponse = {
          content: [
            {text: 'Valid text', type: 'text'},
            {data: 'something', type: 'unknown_type'},
          ],
          id: 'msg_unknown',
          model: 'claude-3-5-sonnet-20241022',
          role: 'assistant',
        }

        const result = formatter.parseResponse(claudeResponse)

        expect(result).to.have.lengthOf(1)
        // Should only parse the text block
        expect(result[0]?.content).to.equal('Valid text')
        expect(result[0]?.toolCalls).to.be.undefined
      })
    })
  })

  describe('round-trip consistency', () => {
    it('should handle format -> parseResponse -> format cycle for simple messages', () => {
      // Simulate Claude response (would come from API)
      const claudeResponse = {
        content: [{text: 'Hi there!', type: 'text'}],
        id: 'msg_round',
        model: 'claude-3-5-sonnet-20241022',
        role: 'assistant',
        stop_reason: 'end_turn',
        stop_sequence: null,
        type: 'message',
        usage: {input_tokens: 10, output_tokens: 10},
      } as any as Message

      // Parse response back to internal format
      const parsed = formatter.parseResponse(claudeResponse)

      // Format parsed message again
      const reformatted = formatter.format(parsed)

      expect(reformatted).to.have.lengthOf(1)
      expect(reformatted[0]?.role).to.equal('assistant')
    })

    it('should preserve tool call structure through round-trip', () => {
      const original: InternalMessage[] = [
        {
          content: 'Using tool',
          role: 'assistant',
          toolCalls: [
            {
              function: {
                arguments: '{"test": true}',
                name: 'test_tool',
              },
              id: 'call_xyz',
              type: 'function',
            },
          ],
        },
      ]

      const formatted = formatter.format(original)
      const content = formatted[0]?.content as Array<{type: string}>

      // Should have text + tool_use blocks
      expect(content.some((block) => block.type === 'tool_use')).to.be.true

      // Simulate response with tool use
      const response = {
        content: [
          {
            id: 'call_xyz',
            input: {test: true},
            name: 'test_tool',
            type: 'tool_use',
          },
        ],
        id: 'msg_rt',
        model: 'claude-3-5-sonnet-20241022',
        role: 'assistant',
        stop_reason: 'tool_use',
        stop_sequence: null,
        type: 'message',
        usage: {input_tokens: 50, output_tokens: 40},
      } as any as Message

      const parsed = formatter.parseResponse(response)

      expect(parsed[0]?.toolCalls).to.have.lengthOf(1)
      expect(parsed[0]?.toolCalls?.[0]?.function.name).to.equal('test_tool')
    })
  })
})
