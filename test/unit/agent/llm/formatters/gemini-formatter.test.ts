/* eslint-disable @typescript-eslint/no-explicit-any */
import type {Content} from '@google/genai'

import {expect} from 'chai'

import type {InternalMessage} from '../../../../../src/agent/core/interfaces/message-types.js'

import {GeminiMessageFormatter} from '../../../../../src/agent/infra/llm/formatters/gemini-formatter.js'

describe('GeminiMessageFormatter', () => {
  let formatter: GeminiMessageFormatter

  beforeEach(() => {
    formatter = new GeminiMessageFormatter()
  })

  describe('format', () => {
    describe('basic message formatting', () => {
      it('should format simple user message', () => {
        const history: InternalMessage[] = [
          {
            content: 'Hello, Gemini!',
            role: 'user',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]).to.deep.equal({
          parts: [{text: 'Hello, Gemini!'}],
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
        expect(result[0]?.role).to.equal('model') // Gemini uses 'model' instead of 'assistant'
        expect(result[0]?.parts).to.deep.equal([{text: 'Hello! How can I help you?'}])
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
        expect(result[1]?.role).to.equal('model')
        expect(result[2]?.role).to.equal('user')
      })
    })

    describe('system message handling', () => {
      it('should convert system messages to user messages with prefix', () => {
        const history: InternalMessage[] = [
          {content: 'You are a helpful assistant', role: 'system'},
          {content: 'Hello', role: 'user'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(2)
        expect(result[0]?.role).to.equal('user')
        expect(result[0]?.parts).to.deep.equal([{text: 'System: You are a helpful assistant'}])
        expect(result[1]?.role).to.equal('user')
      })

      it('should add system prompt as first user message', () => {
        const history: InternalMessage[] = [
          {content: 'Hello', role: 'user'},
        ]

        const result = formatter.format(history, 'You are a coding assistant')

        expect(result).to.have.lengthOf(2)
        expect(result[0]?.role).to.equal('user')
        expect(result[0]?.parts).to.deep.equal([{text: 'System: You are a coding assistant'}])
        expect(result[1]?.role).to.equal('user')
        expect(result[1]?.parts).to.deep.equal([{text: 'Hello'}])
      })

      it('should handle multiple system messages', () => {
        const history: InternalMessage[] = [
          {content: 'System 1', role: 'system'},
          {content: 'Hello', role: 'user'},
          {content: 'System 2', role: 'system'},
          {content: 'Response', role: 'assistant'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(4)
        expect(result[0]?.parts).to.deep.equal([{text: 'System: System 1'}])
        expect(result[2]?.parts).to.deep.equal([{text: 'System: System 2'}])
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
        const content = result[0] as Content
        expect(content.role).to.equal('model')
        expect(content.parts).to.have.lengthOf(2)

        // First part should be text
        expect(content.parts![0]).to.deep.equal({text: 'Let me search for that'})

        // Second part should be functionCall
        expect(content.parts![1]).to.deep.equal({
          functionCall: {
            args: {query: 'test'},
            name: 'search',
          },
        })
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

        const content = result[0] as Content
        expect(content.parts).to.have.lengthOf(3) // 1 text + 2 functionCall

        expect(content.parts![1]).to.have.property('functionCall')
        expect(content.parts![2]).to.have.property('functionCall')
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

        const content = result[0] as Content
        // Should only have functionCall, no empty text
        expect(content.parts).to.have.lengthOf(1)
        expect(content.parts![0]).to.have.property('functionCall')
      })
    })

    describe('tool result formatting', () => {
      it('should format single tool result message', () => {
        const history: InternalMessage[] = [
          {
            content: '{"result": "Found 5 items"}',
            name: 'search',
            role: 'tool',
            toolCallId: 'call_123',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        const content = result[0] as Content
        expect(content.role).to.equal('user') // Tool results sent as user messages

        expect(content.parts).to.have.lengthOf(1)
        expect(content.parts![0]).to.deep.equal({
          functionResponse: {
            name: 'search',
            response: {result: 'Found 5 items'},
          },
        })
      })

      it('should combine consecutive tool results into single user message', () => {
        const history: InternalMessage[] = [
          {
            content: '{"result": "Result 1"}',
            name: 'tool1',
            role: 'tool',
            toolCallId: 'call_1',
          },
          {
            content: '{"result": "Result 2"}',
            name: 'tool2',
            role: 'tool',
            toolCallId: 'call_2',
          },
        ]

        const result = formatter.format(history)

        // Should combine into one user message
        expect(result).to.have.lengthOf(1)
        const content = result[0] as Content
        expect(content.role).to.equal('user')
        expect(content.parts).to.have.lengthOf(2)

        expect(content.parts![0]).to.have.property('functionResponse')
        expect(content.parts![1]).to.have.property('functionResponse')
      })

      it('should flush tool results before non-tool messages', () => {
        const history: InternalMessage[] = [
          {
            content: 'Search',
            role: 'user',
          },
          {
            content: null,
            role: 'assistant',
            toolCalls: [{function: {arguments: '{}', name: 'search'}, id: 'c1', type: 'function'}],
          },
          {
            content: '{"result": "Found"}',
            name: 'search',
            role: 'tool',
            toolCallId: 'c1',
          },
          {
            content: 'Here are the results',
            role: 'assistant',
          },
        ]

        const result = formatter.format(history)

        // user, assistant (with tool call), user (tool result), assistant
        expect(result).to.have.lengthOf(4)
        expect(result[0]?.role).to.equal('user')
        expect(result[1]?.role).to.equal('model')
        expect(result[2]?.role).to.equal('user') // Tool result
        expect(result[3]?.role).to.equal('model')
      })

      it('should handle tool result with null content', () => {
        const history: InternalMessage[] = [
          {
            content: null,
            name: 'tool',
            role: 'tool',
            toolCallId: 'call_456',
          },
        ]

        const result = formatter.format(history)

        const content = result[0] as Content
        expect(content.parts![0]).to.deep.equal({
          functionResponse: {
            name: 'tool',
            response: {result: null},
          },
        })
      })

      it('should parse JSON string content in tool results', () => {
        const history: InternalMessage[] = [
          {
            content: '{"status": "success", "count": 42}',
            name: 'tool',
            role: 'tool',
            toolCallId: 'call_789',
          },
        ]

        const result = formatter.format(history)

        const content = result[0] as Content
        const part = content.parts![0] as any
        expect(part.functionResponse.response).to.deep.equal({
          count: 42,
          status: 'success',
        })
      })

      it('should handle non-JSON string content in tool results', () => {
        const history: InternalMessage[] = [
          {
            content: 'plain text result',
            name: 'tool',
            role: 'tool',
            toolCallId: 'call_abc',
          },
        ]

        const result = formatter.format(history)

        const content = result[0] as Content
        const part = content.parts![0] as any
        // Non-JSON string should be wrapped in result
        expect(part.functionResponse.response).to.deep.equal({
          result: 'plain text result',
        })
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

        const content = result[0] as Content
        expect(content.parts).to.have.lengthOf(2)
        expect(content.parts![0]).to.deep.equal({text: 'First part'})
        expect(content.parts![1]).to.deep.equal({text: 'Second part'})
      })

      it('should handle image parts with placeholder', () => {
        const history = [
          {
            content: [
              {text: 'Look at this image:', type: 'text'},
              {image: 'base64data', mimeType: 'image/png', type: 'image'},
            ],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const content = result[0] as Content
        expect(content.parts).to.have.lengthOf(2)
        expect(content.parts![0]).to.deep.equal({text: 'Look at this image:'})
        // Image support implemented with inlineData
        expect(content.parts![1]).to.deep.equal({
          inlineData: {
            data: 'base64data',
            mimeType: 'image/png',
          },
        })
      })

      it('should handle file parts with placeholder', () => {
        const history = [
          {
            content: [
              {data: 'pdfbase64data', filename: 'test.pdf', mimeType: 'application/pdf', type: 'file'},
            ],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const content = result[0] as Content
        // File support implemented with inlineData
        expect(content.parts![0]).to.deep.equal({
          inlineData: {
            data: 'pdfbase64data',
            mimeType: 'application/pdf',
          },
        })
      })

      it('should handle unknown content type', () => {
        const history = [
          {
            content: [{type: 'unknown_type' as 'text'}],
            role: 'user',
          },
        ] as any as InternalMessage[]

        const result = formatter.format(history)

        const content = result[0] as Content
        expect(content.parts![0]).to.deep.equal({text: '[Unknown content type]'})
      })
    })

    describe('edge cases', () => {
      it('should handle empty history', () => {
        const result = formatter.format([])
        expect(result).to.have.lengthOf(0)
      })

      it('should handle empty system prompt', () => {
        const history: InternalMessage[] = [{content: 'Hello', role: 'user'}]
        const result = formatter.format(history, '')

        // Empty system prompt should not be added
        expect(result).to.have.lengthOf(1)
        expect(result[0]?.parts).to.deep.equal([{text: 'Hello'}])
      })

      it('should handle null system prompt', () => {
        const history: InternalMessage[] = [{content: 'Hello', role: 'user'}]
        const result = formatter.format(history, null)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.parts).to.deep.equal([{text: 'Hello'}])
      })

      it('should handle user message with empty string content', () => {
        const history: InternalMessage[] = [
          {content: '', role: 'user'},
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.parts).to.deep.equal([{text: ''}])
      })

      it('should handle user message with empty array content', () => {
        const history: InternalMessage[] = [
          {content: [], role: 'user'},
        ]

        const result = formatter.format(history)

        const content = result[0] as Content
        expect(content.parts).to.have.lengthOf(0)
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
        expect((result[0] as Content).parts![0]).to.deep.equal({text: 'Message 1'})
        expect((result[1] as Content).parts![0]).to.deep.equal({text: 'Message 2'})
        expect((result[2] as Content).parts![0]).to.deep.equal({text: 'Message 3'})
        expect((result[3] as Content).parts![0]).to.deep.equal({text: 'Message 4'})
      })

      it('should flush remaining tool results at end', () => {
        const history: InternalMessage[] = [
          {content: 'User message', role: 'user'},
          {
            content: '{"result": "data"}',
            name: 'tool',
            role: 'tool',
            toolCallId: 'call_1',
          },
        ]

        const result = formatter.format(history)

        expect(result).to.have.lengthOf(2)
        expect(result[1]?.role).to.equal('user')
        expect((result[1] as Content).parts![0]).to.have.property('functionResponse')
      })
    })
  })

  describe('parseResponse', () => {
    describe('basic response parsing', () => {
      it('should parse text-only response', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Hello! How can I help you?',
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.role).to.equal('assistant')
        expect(result[0]?.content).to.equal('Hello! How can I help you?')
        expect(result[0]?.toolCalls).to.be.undefined
      })

      it('should parse response with multiple text parts', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {text: 'First part. '},
                  {text: 'Second part.'},
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(1)
        // Text parts should be concatenated
        expect(result[0]?.content).to.equal('First part. Second part.')
      })

      it('should return empty array for response with no candidates', () => {
        const geminiResponse: any = {
          candidates: [],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(0)
      })

      it('should return empty array for response with no content', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: null,
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(0)
      })

      it('should return empty array for response with no parts', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: null,
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(0)
      })
    })

    describe('tool use response parsing', () => {
      it('should parse response with single function call', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Let me search for that.',
                  },
                  {
                    functionCall: {
                      args: {query: 'test query'},
                      name: 'search',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal('Let me search for that.')
        expect(result[0]?.toolCalls).to.exist
        expect(result[0]?.toolCalls).to.have.lengthOf(1)

        const toolCall = result[0]?.toolCalls?.[0]
        expect(toolCall?.type).to.equal('function')
        expect(toolCall?.function.name).to.equal('search')
        expect(toolCall?.function.arguments).to.equal('{"query":"test query"}')
        expect(toolCall?.id).to.match(/^call_\d+_[a-z0-9]+_search$/)
      })

      it('should parse response with multiple function calls', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {query: 'first'},
                      name: 'search',
                    },
                  },
                  {
                    functionCall: {
                      args: {query: 'second'},
                      name: 'search',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result[0]?.toolCalls).to.have.lengthOf(2)
        expect(result[0]?.toolCalls?.[0]?.function.name).to.equal('search')
        expect(result[0]?.toolCalls?.[1]?.function.name).to.equal('search')
      })

      it('should parse response with function call but no text', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {param: 'value'},
                      name: 'my_tool',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result[0]?.content).to.equal(null) // Empty text becomes null
        expect(result[0]?.toolCalls).to.have.lengthOf(1)
      })

      it('should parse function call with complex args', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {
                        array: [1, 2, 3],
                        nested: {deep: {value: 'test'}},
                        number: 42,
                        string: 'hello',
                      },
                      name: 'complex_tool',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const toolCall = result[0]?.toolCalls?.[0]
        const parsedArgs = JSON.parse(toolCall?.function.arguments ?? '{}')
        expect(parsedArgs).to.deep.equal({
          array: [1, 2, 3],
          nested: {deep: {value: 'test'}},
          number: 42,
          string: 'hello',
        })
      })

      it('should handle function call with empty args', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {},
                      name: 'no_args_tool',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const toolCall = result[0]?.toolCalls?.[0]
        expect(toolCall?.function.arguments).to.equal('{}')
      })

      it('should handle function call with undefined args', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: undefined,
                      name: 'undefined_args_tool',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const toolCall = result[0]?.toolCalls?.[0]
        expect(toolCall?.function.arguments).to.equal('{}')
      })

      it('should handle function call with undefined name', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {test: true},
                      name: undefined,
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const toolCall = result[0]?.toolCalls?.[0]
        expect(toolCall?.function.name).to.equal('')
      })
    })

    describe('mixed content response parsing', () => {
      it('should parse response with text and function call mixed', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {text: 'First, '},
                  {
                    functionCall: {
                      args: {action: 'search'},
                      name: 'tool',
                    },
                  },
                  {text: ' then done.'},
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        // Text parts should be concatenated
        expect(result[0]?.content).to.equal('First,  then done.')
        expect(result[0]?.toolCalls).to.have.lengthOf(1)
      })

      it('should handle empty text parts', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {text: ''},
                  {text: 'non-empty'},
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result[0]?.content).to.equal('non-empty')
      })
    })

    describe('edge cases', () => {
      it('should handle response with no candidates', () => {
        const geminiResponse: any = {
          candidates: [],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(0)
      })

      it('should handle response with undefined candidates', () => {
        const geminiResponse: any = {
          candidates: undefined,
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(0)
      })

      it('should handle response with empty parts array', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(1)
        expect(result[0]?.content).to.equal(null)
        expect(result[0]?.toolCalls).to.be.undefined
      })

      it('should ignore unknown part types', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {text: 'Valid text'},
                  {unknownField: 'unknown data'},
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        expect(result).to.have.lengthOf(1)
        // Should only parse the text part
        expect(result[0]?.content).to.equal('Valid text')
        expect(result[0]?.toolCalls).to.be.undefined
      })
    })

    describe('tool call ID generation', () => {
      it('should generate unique tool call IDs', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {},
                      name: 'tool1',
                    },
                  },
                  {
                    functionCall: {
                      args: {},
                      name: 'tool2',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const id1 = result[0]?.toolCalls?.[0]?.id
        const id2 = result[0]?.toolCalls?.[1]?.id

        expect(id1).to.not.equal(id2)
        expect(id1).to.include('tool1')
        expect(id2).to.include('tool2')
      })

      it('should include tool name in generated ID', () => {
        const geminiResponse: any = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      args: {},
                      name: 'my_special_tool',
                    },
                  },
                ],
                role: 'model',
              },
            },
          ],
        }

        const result = formatter.parseResponse(geminiResponse)

        const id = result[0]?.toolCalls?.[0]?.id
        expect(id).to.include('my_special_tool')
        expect(id).to.match(/^call_\d+_[a-z0-9]+_my_special_tool$/)
      })
    })
  })

  describe('round-trip consistency', () => {
    it('should handle format -> parseResponse -> format cycle for simple messages', () => {
      // Simulate Gemini response (would come from API)
      const geminiResponse: any = {
        candidates: [
          {
            content: {
              parts: [{text: 'Hi there!'}],
              role: 'model',
            },
          },
        ],
      }

      // Parse response back to internal format
      const parsed = formatter.parseResponse(geminiResponse)

      // Format parsed message again
      const reformatted = formatter.format(parsed)

      expect(reformatted).to.have.lengthOf(1)
      expect(reformatted[0]?.role).to.equal('model')
      expect((reformatted[0] as Content).parts![0]).to.deep.equal({text: 'Hi there!'})
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
      const content = formatted[0] as Content

      // Should have text + functionCall parts
      expect(content.parts!.some((part) => 'functionCall' in part)).to.be.true

      // Simulate response with function call
      const response: any = {
        candidates: [
          {
            content: {
              parts: [
                {text: 'Using tool'},
                {
                  functionCall: {
                    args: {test: true},
                    name: 'test_tool',
                  },
                },
              ],
              role: 'model',
            },
          },
        ],
      }

      const parsed = formatter.parseResponse(response)

      expect(parsed[0]?.toolCalls).to.have.lengthOf(1)
      expect(parsed[0]?.toolCalls?.[0]?.function.name).to.equal('test_tool')
      expect(parsed[0]?.content).to.equal('Using tool')
    })
  })
})
