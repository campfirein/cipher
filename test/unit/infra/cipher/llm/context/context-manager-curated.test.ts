import {expect} from 'chai'

import type {IMessageFormatter} from '../../../../../../src/core/interfaces/cipher/i-message-formatter.js'
import type {ITokenizer} from '../../../../../../src/core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../../../src/core/interfaces/cipher/message-types.js'

import {ContextManager} from '../../../../../../src/infra/cipher/llm/context/context-manager.js'

/**
 * Simple mock formatter for testing
 */
class MockFormatter implements IMessageFormatter<InternalMessage> {
  format(history: Readonly<InternalMessage[]>, _systemPrompt?: null | string): InternalMessage[] {
    return [...history]
  }

  parseResponse(_response: unknown): InternalMessage[] {
    return []
  }
}

/**
 * Simple mock tokenizer for testing
 */
class MockTokenizer implements ITokenizer {
  countTokens(text: string): number {
    // Simple approximation: ~4 chars per token
    return Math.ceil(text.length / 4)
  }
}

describe('ContextManager - Curated History', () => {
  let contextManager: ContextManager<InternalMessage>
  let formatter: MockFormatter
  let tokenizer: MockTokenizer

  beforeEach(() => {
    formatter = new MockFormatter()
    tokenizer = new MockTokenizer()
    contextManager = new ContextManager({
      formatter,
      maxInputTokens: 100_000,
      sessionId: 'test-session',
      tokenizer,
    })
  })

  describe('getCuratedMessages', () => {
    it('should return empty array when no messages', () => {
      const curated = contextManager.getCuratedMessages()
      expect(curated).to.deep.equal([])
    })

    it('should return all valid messages', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage('Hi there!')

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(2)
      expect(curated[0].content).to.equal('Hello')
      expect(curated[1].content).to.equal('Hi there!')
    })

    it('should filter out empty assistant messages without tool calls', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage(null) // Empty message without tool calls
      await contextManager.addAssistantMessage('Valid response')

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(2)
      expect(curated[0].content).to.equal('Hello')
      expect(curated[1].content).to.equal('Valid response')
    })

    it('should keep assistant messages with tool calls even if content is null', async () => {
      await contextManager.addUserMessage('Search for files')
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"query": "test"}', name: 'search'},
          id: 'call-1',
          type: 'function',
        },
      ])

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(2)
      expect(curated[1].toolCalls).to.have.lengthOf(1)
    })

    it('should filter out empty system messages', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addSystemMessage('') // Empty system message
      await contextManager.addSystemMessage('   ') // Whitespace-only system message
      await contextManager.addAssistantMessage('Hi!')

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(2)
      expect(curated[0].role).to.equal('user')
      expect(curated[1].role).to.equal('assistant')
    })

    it('should keep valid system messages', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addSystemMessage('Important context')
      await contextManager.addAssistantMessage('Hi!')

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(3)
      expect(curated[1].role).to.equal('system')
      expect(curated[1].content).to.equal('Important context')
    })

    it('should filter out tool results without toolCallId', async () => {
      await contextManager.addUserMessage('Read file')

      // Manually add an invalid tool result (missing toolCallId)
      // This simulates a corrupted message
      const messages = contextManager.getMessages()
      messages.push({
        content: 'file contents',
        name: 'readFile',
        role: 'tool',
        // toolCallId is missing!
      })

      // The getCuratedMessages should filter this out
      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(1)
      expect(curated[0].role).to.equal('user')
    })

    it('should keep valid tool results', async () => {
      await contextManager.addUserMessage('Read file')
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"path": "/test.txt"}', name: 'readFile'},
          id: 'call-1',
          type: 'function',
        },
      ])
      await contextManager.addToolResult('call-1', 'readFile', 'file contents', {success: true})

      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(3)
      expect(curated[2].role).to.equal('tool')
      expect(curated[2].toolCallId).to.equal('call-1')
    })
  })

  describe('getComprehensiveMessages', () => {
    it('should return all messages including invalid ones', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage(null) // Invalid
      await contextManager.addSystemMessage('') // Invalid
      await contextManager.addAssistantMessage('Valid')

      const comprehensive = contextManager.getComprehensiveMessages()
      expect(comprehensive).to.have.lengthOf(4)
    })

    it('should return defensive copy', async () => {
      await contextManager.addUserMessage('Hello')

      const messages1 = contextManager.getComprehensiveMessages()
      messages1.push({content: 'injected', role: 'user'})

      const messages2 = contextManager.getComprehensiveMessages()
      expect(messages2).to.have.lengthOf(1)
    })
  })

  describe('getFormattedMessagesWithCompression', () => {
    it('should return messagesFiltered count', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage(null) // Will be filtered
      await contextManager.addAssistantMessage('Hi!')

      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.messagesFiltered).to.equal(1)
      expect(result.formattedMessages).to.have.lengthOf(2)
    })

    it('should return 0 messagesFiltered when all messages are valid', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage('Hi there!')

      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.messagesFiltered).to.equal(0)
      expect(result.formattedMessages).to.have.lengthOf(2)
    })

    it('should use curated messages for formatting', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addSystemMessage('') // Invalid - should be filtered
      await contextManager.addAssistantMessage('Hi!')

      const result = await contextManager.getFormattedMessagesWithCompression()

      // Only 2 messages should be in the formatted output
      expect(result.formattedMessages).to.have.lengthOf(2)
      expect(result.formattedMessages[0].content).to.equal('Hello')
      expect(result.formattedMessages[1].content).to.equal('Hi!')
    })

    it('should correctly count tokens from curated messages only', async () => {
      await contextManager.addUserMessage('Hello') // ~2 tokens
      await contextManager.addSystemMessage('') // Invalid - filtered
      await contextManager.addAssistantMessage('World') // ~2 tokens

      const result = await contextManager.getFormattedMessagesWithCompression()

      // Token count should not include the empty system message
      // With our mock tokenizer (~4 chars/token), "Hello" + "World" = ~3-4 tokens
      // The actual count may include some overhead, so we just verify it's reasonable
      expect(result.tokensUsed).to.be.greaterThan(0)
      expect(result.tokensUsed).to.be.lessThan(20) // Reasonable upper bound
      expect(result.messagesFiltered).to.equal(1)
    })
  })

  describe('validation rules', () => {
    describe('empty_content rule', () => {
      it('should filter assistant message with null content and no tool calls', async () => {
        await contextManager.addAssistantMessage(null)

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(0)
      })

      it('should filter assistant message with empty string content', async () => {
        await contextManager.addAssistantMessage('')

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(0)
      })

      it('should NOT filter user message with content', async () => {
        await contextManager.addUserMessage('Hello')

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(1)
      })
    })

    describe('incomplete_tool_call rule', () => {
      it('should filter tool message without toolCallId', async () => {
        // Manually add invalid tool message
        const messages = contextManager.getMessages()
        messages.push({
          content: 'result',
          name: 'testTool',
          role: 'tool',
          // Missing toolCallId
        })

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(0)
      })

      it('should NOT filter tool message with toolCallId', async () => {
        await contextManager.addToolResult('call-123', 'testTool', 'result', {success: true})

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(1)
        expect(curated[0].toolCallId).to.equal('call-123')
      })
    })

    describe('system_noise rule', () => {
      it('should filter system message with empty content', async () => {
        await contextManager.addSystemMessage('')

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(0)
      })

      it('should filter system message with whitespace only', async () => {
        await contextManager.addSystemMessage('   \n\t  ')

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(0)
      })

      it('should NOT filter system message with actual content', async () => {
        await contextManager.addSystemMessage('You are a helpful assistant')

        const curated = contextManager.getCuratedMessages()
        expect(curated).to.have.lengthOf(1)
      })
    })
  })

  describe('integration - typical conversation flow', () => {
    it('should handle realistic conversation with mixed valid/invalid messages', async () => {
      // User starts
      await contextManager.addUserMessage('Search for config files')

      // Assistant makes tool call
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"query": "*.config.ts"}', name: 'search'},
          id: 'call-1',
          type: 'function',
        },
      ])

      // Tool result
      await contextManager.addToolResult('call-1', 'search', 'Found: app.config.ts', {success: true})

      // Empty system message (noise)
      await contextManager.addSystemMessage('')

      // Assistant responds
      await contextManager.addAssistantMessage('I found app.config.ts. Would you like me to read it?')

      // User confirms
      await contextManager.addUserMessage('Yes, read it')

      // Check curated messages
      const curated = contextManager.getCuratedMessages()
      expect(curated).to.have.lengthOf(5) // User, Assistant+tool, Tool result, Assistant, User

      // Check comprehensive messages
      const comprehensive = contextManager.getComprehensiveMessages()
      expect(comprehensive).to.have.lengthOf(6) // Includes empty system message

      // Formatted result should show 1 filtered message
      const result = await contextManager.getFormattedMessagesWithCompression()
      expect(result.messagesFiltered).to.equal(1)
      expect(result.formattedMessages).to.have.lengthOf(5)
    })
  })
})
