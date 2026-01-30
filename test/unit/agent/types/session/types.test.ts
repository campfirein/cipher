import {expect} from 'chai'
import {expectTypeOf} from 'expect-type'

import type {
  LLMResponse,
  Message,
  MessageRole,
  SessionConfig,
  ToolCall,
} from '../../../../../src/agent/core/domain/session/types.js'

describe('cipher/session', () => {
  describe('Type Safety - MessageRole', () => {
    it('should enforce MessageRole union type', () => {
      const assistant: MessageRole = 'assistant'
      const system: MessageRole = 'system'
      const tool: MessageRole = 'tool'
      const user: MessageRole = 'user'

      expectTypeOf<MessageRole>(assistant)
      expectTypeOf<MessageRole>(system)
      expectTypeOf<MessageRole>(tool)
      expectTypeOf<MessageRole>(user)
    })

    it('should include all four role types', () => {
      const roles: MessageRole[] = ['assistant', 'system', 'tool', 'user']

      for (const role of roles) {
        expectTypeOf<MessageRole>(role)
      }
    })
  })

  describe('Type Safety - ToolCall', () => {
    it('should enforce all required fields', () => {
      const toolCall: ToolCall = {
        arguments: {param1: 'value1', param2: 123},
        id: 'call-123',
        name: 'myTool',
      }

      expectTypeOf<Record<string, unknown>>(toolCall.arguments)
      expectTypeOf<string>(toolCall.id)
      expectTypeOf<string>(toolCall.name)
    })

    it('should enforce Record type for arguments', () => {
      const toolCall: ToolCall = {
        arguments: {
          boolean: true,
          nested: {deep: 'value'},
          number: 42,
          string: 'value',
        },
        id: 'call-456',
        name: 'complexTool',
      }

      expectTypeOf<Record<string, unknown>>(toolCall.arguments)
    })

    it('should allow empty arguments object', () => {
      const emptyArgs: ToolCall = {
        arguments: {},
        id: 'call-789',
        name: 'noArgsTool',
      }

      expectTypeOf<ToolCall>(emptyArgs)
      expectTypeOf<Record<string, unknown>>(emptyArgs.arguments)
    })
  })

  describe('Type Safety - Message', () => {
    it('should enforce required fields', () => {
      const message: Message = {
        content: 'Hello, world!',
        role: 'user',
        timestamp: Date.now(),
        toolCallId: 'call-123',
        toolCalls: [
          {
            arguments: {},
            id: 'call-1',
            name: 'tool1',
          },
        ],
        toolName: 'myTool',
      }

      expectTypeOf<string>(message.content)
      expectTypeOf<MessageRole>(message.role)
      expectTypeOf<number | undefined>(message.timestamp)
      expectTypeOf<string | undefined>(message.toolCallId)
      expectTypeOf<ToolCall[] | undefined>(message.toolCalls)
      expectTypeOf<string | undefined>(message.toolName)
    })

    it('should make optional fields optional', () => {
      const minimalMessage: Message = {
        content: 'Hello',
        role: 'user',
      }

      expectTypeOf<Message>(minimalMessage)
      expectTypeOf<number | undefined>(minimalMessage.timestamp)
      expectTypeOf<string | undefined>(minimalMessage.toolCallId)
      expectTypeOf<ToolCall[] | undefined>(minimalMessage.toolCalls)
      expectTypeOf<string | undefined>(minimalMessage.toolName)
    })

    it('should support user messages', () => {
      const userMessage: Message = {
        content: 'What is the weather?',
        role: 'user',
        timestamp: Date.now(),
      }

      expectTypeOf<Message>(userMessage)
    })

    it('should support assistant messages', () => {
      const assistantMessage: Message = {
        content: 'The weather is sunny.',
        role: 'assistant',
        timestamp: Date.now(),
      }

      expectTypeOf<Message>(assistantMessage)
    })

    it('should support assistant messages with tool calls', () => {
      const assistantWithTools: Message = {
        content: '',
        role: 'assistant',
        toolCalls: [
          {
            arguments: {city: 'San Francisco'},
            id: 'call-weather',
            name: 'get_weather',
          },
        ],
      }

      expectTypeOf<Message>(assistantWithTools)
      expectTypeOf<ToolCall[] | undefined>(assistantWithTools.toolCalls)
    })

    it('should support tool result messages', () => {
      const toolMessage: Message = {
        content: '{"temperature": 72, "condition": "sunny"}',
        role: 'tool',
        toolCallId: 'call-weather',
        toolName: 'get_weather',
      }

      expectTypeOf<Message>(toolMessage)
      expectTypeOf<string | undefined>(toolMessage.toolCallId)
      expectTypeOf<string | undefined>(toolMessage.toolName)
    })

    it('should support system messages', () => {
      const systemMessage: Message = {
        content: 'You are a helpful assistant.',
        role: 'system',
      }

      expectTypeOf<Message>(systemMessage)
    })
  })

  describe('Type Safety - SessionConfig', () => {
    it('should make all fields optional', () => {
      const fullConfig: SessionConfig = {
        maxToolIterations: 10,
        systemPrompt: 'You are a helpful assistant.',
      }

      expectTypeOf<number | undefined>(fullConfig.maxToolIterations)
      expectTypeOf<string | undefined>(fullConfig.systemPrompt)

      // Empty config is valid
      const emptyConfig: SessionConfig = {}
      expectTypeOf<SessionConfig>(emptyConfig)
    })

    it('should allow partial configuration', () => {
      const maxOnly: SessionConfig = {
        maxToolIterations: 5,
      }

      const promptOnly: SessionConfig = {
        systemPrompt: 'Custom prompt',
      }

      expectTypeOf<SessionConfig>(maxOnly)
      expectTypeOf<SessionConfig>(promptOnly)
    })

    it('should enforce correct types', () => {
      const config: SessionConfig = {
        maxToolIterations: 15,
        systemPrompt: 'System prompt text',
      }

      expectTypeOf<number | undefined>(config.maxToolIterations)
      expectTypeOf<string | undefined>(config.systemPrompt)
    })
  })

  describe('Type Safety - LLMResponse', () => {
    it('should enforce required content field', () => {
      const response: LLMResponse = {
        content: 'Response from LLM',
        toolCalls: [
          {
            arguments: {query: 'search term'},
            id: 'call-1',
            name: 'search',
          },
        ],
      }

      expectTypeOf<string>(response.content)
      expectTypeOf<ToolCall[] | undefined>(response.toolCalls)
    })

    it('should make toolCalls optional', () => {
      const textOnly: LLMResponse = {
        content: 'Just text, no tools',
      }

      expectTypeOf<LLMResponse>(textOnly)
      expectTypeOf<ToolCall[] | undefined>(textOnly.toolCalls)
    })

    it('should support response with tool calls', () => {
      const withTools: LLMResponse = {
        content: '',
        toolCalls: [
          {
            arguments: {file: 'package.json'},
            id: 'call-read',
            name: 'read_file',
          },
          {
            arguments: {command: 'npm test'},
            id: 'call-exec',
            name: 'bash_exec',
          },
        ],
      }

      expectTypeOf<LLMResponse>(withTools)
      expectTypeOf<ToolCall[] | undefined>(withTools.toolCalls)

      if (withTools.toolCalls) {
        expectTypeOf<ToolCall[]>(withTools.toolCalls)
        expect(withTools.toolCalls).to.have.length(2)
      }
    })

    it('should support empty content with tool calls', () => {
      const toolsOnly: LLMResponse = {
        content: '',
        toolCalls: [
          {
            arguments: {},
            id: 'call-1',
            name: 'tool1',
          },
        ],
      }

      expectTypeOf<LLMResponse>(toolsOnly)
      expectTypeOf<string>(toolsOnly.content)
    })
  })

  describe('Type Safety - Conversation Flow', () => {
    it('should support a complete conversation flow', () => {
      const config: SessionConfig = {
        maxToolIterations: 10,
        systemPrompt: 'You are a helpful assistant.',
      }

      const messages: Message[] = [
        {
          content: 'You are a helpful assistant.',
          role: 'system',
        },
        {
          content: 'What files are in this directory?',
          role: 'user',
          timestamp: Date.now(),
        },
        {
          content: '',
          role: 'assistant',
          toolCalls: [
            {
              arguments: {pattern: '*'},
              id: 'call-glob',
              name: 'glob_files',
            },
          ],
        },
        {
          content: '["package.json", "README.md"]',
          role: 'tool',
          toolCallId: 'call-glob',
          toolName: 'glob_files',
        },
        {
          content: 'The directory contains package.json and README.md files.',
          role: 'assistant',
        },
      ]

      expectTypeOf<SessionConfig>(config)
      expectTypeOf<Message[]>(messages)

      for (const msg of messages) {
        expectTypeOf<Message>(msg)
      }
    })

    it('should support LLM response to message conversion', () => {
      const llmResponse: LLMResponse = {
        content: 'Here is my response',
        toolCalls: [
          {
            arguments: {path: 'file.txt'},
            id: 'call-1',
            name: 'read_file',
          },
        ],
      }

      const message: Message = {
        content: llmResponse.content,
        role: 'assistant',
        toolCalls: llmResponse.toolCalls,
      }

      expectTypeOf<LLMResponse>(llmResponse)
      expectTypeOf<Message>(message)
    })
  })
})
