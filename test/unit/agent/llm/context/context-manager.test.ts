import {expect} from 'chai'
import * as sinon from 'sinon'

import type {IHistoryStorage} from '../../../../../src/agent/interfaces/i-history-storage.js'
import type {ILogger} from '../../../../../src/agent/interfaces/i-logger.js'
import type {IMessageFormatter} from '../../../../../src/agent/interfaces/i-message-formatter.js'
import type {ITokenizer} from '../../../../../src/agent/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../../../src/agent/interfaces/message-types.js'

import {ContextManager} from '../../../../../src/agent/llm/context/context-manager.js'

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

/**
 * Mock history storage for testing persistence
 */
class MockHistoryStorage implements IHistoryStorage {
  private storage: Map<string, InternalMessage[]> = new Map()

  async deleteHistory(sessionId: string): Promise<void> {
    this.storage.delete(sessionId)
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.storage.has(sessionId)
  }

  async getSessionMetadata(_sessionId: string): Promise<undefined> {
    return undefined
  }

  async listSessions(): Promise<string[]> {
    return [...this.storage.keys()]
  }

  async loadHistory(sessionId: string): Promise<InternalMessage[] | undefined> {
    return this.storage.get(sessionId)
  }

  async saveHistory(sessionId: string, messages: InternalMessage[]): Promise<void> {
    this.storage.set(sessionId, messages)
  }
}

describe('ContextManager', () => {
  let contextManager: ContextManager<InternalMessage>
  let formatter: MockFormatter
  let tokenizer: MockTokenizer
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    formatter = new MockFormatter()
    tokenizer = new MockTokenizer()
    contextManager = new ContextManager({
      formatter,
      maxInputTokens: 100_000,
      sessionId: 'test-session',
      tokenizer,
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('initialization', () => {
    it('should initialize with required parameters', () => {
      expect(contextManager).to.exist
      expect(contextManager.getSessionId()).to.equal('test-session')
      expect(contextManager.getMaxInputTokens()).to.equal(100_000)
    })

    it('should initialize with empty message history', () => {
      const messages = contextManager.getMessages()
      expect(messages).to.deep.equal([])
    })

    it('should initialize with optional history storage', () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'with-storage',
        tokenizer,
      })

      expect(cm).to.exist
    })

    it('should initialize with optional logger', () => {
      const mockLogger: ILogger = {
        debug: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
      }

      const cm = new ContextManager({
        formatter,
        logger: mockLogger,
        maxInputTokens: 100_000,
        sessionId: 'with-logger',
        tokenizer,
      })

      expect(cm).to.exist
    })

    it('should initialize with custom compression strategies', () => {
      const mockStrategy = {
        compress: sandbox.stub().resolves([]),
        getName: sandbox.stub().returns('MockStrategy'),
      }

      const cm = new ContextManager({
        compressionStrategies: [mockStrategy],
        formatter,
        maxInputTokens: 100_000,
        sessionId: 'with-strategies',
        tokenizer,
      })

      expect(cm).to.exist
    })
  })

  describe('session management', () => {
    it('should return correct session ID', () => {
      expect(contextManager.getSessionId()).to.equal('test-session')
    })

    it('should return correct max input tokens', () => {
      expect(contextManager.getMaxInputTokens()).to.equal(100_000)
    })

    it('should support different session IDs', () => {
      const cm1 = new ContextManager({
        formatter,
        maxInputTokens: 100_000,
        sessionId: 'session-1',
        tokenizer,
      })

      const cm2 = new ContextManager({
        formatter,
        maxInputTokens: 100_000,
        sessionId: 'session-2',
        tokenizer,
      })

      expect(cm1.getSessionId()).to.equal('session-1')
      expect(cm2.getSessionId()).to.equal('session-2')
    })
  })

  describe('addUserMessage', () => {
    it('should add user message to history', async () => {
      await contextManager.addUserMessage('Hello')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.deep.equal({
        content: 'Hello',
        role: 'user',
      })
    })

    it('should add multiple user messages in order', async () => {
      await contextManager.addUserMessage('First message')
      await contextManager.addUserMessage('Second message')
      await contextManager.addUserMessage('Third message')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(3)
      expect(messages[0].content).to.equal('First message')
      expect(messages[1].content).to.equal('Second message')
      expect(messages[2].content).to.equal('Third message')
    })

    it('should handle empty string', async () => {
      await contextManager.addUserMessage('')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('')
    })

    it('should handle long messages', async () => {
      const longMessage = 'a'.repeat(10_000)
      await contextManager.addUserMessage(longMessage)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal(longMessage)
    })
  })

  describe('addAssistantMessage', () => {
    it('should add assistant message with content', async () => {
      await contextManager.addAssistantMessage('Hello! How can I help you?')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('Hello! How can I help you?')
      expect(messages[0].role).to.equal('assistant')
    })

    it('should add assistant message with null content', async () => {
      await contextManager.addAssistantMessage(null)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.be.null
      expect(messages[0].role).to.equal('assistant')
    })

    it('should add assistant message with tool calls', async () => {
      await contextManager.addAssistantMessage('Let me search for that', [
        {
          function: {
            arguments: '{"query": "test"}',
            name: 'search',
          },
          id: 'call-1',
          type: 'function',
        },
      ])

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('Let me search for that')
      expect(messages[0].toolCalls).to.have.lengthOf(1)
      expect(messages[0].toolCalls?.[0].id).to.equal('call-1')
    })

    it('should add assistant message with multiple tool calls', async () => {
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"query": "test1"}', name: 'search'},
          id: 'call-1',
          type: 'function',
        },
        {
          function: {arguments: '{"query": "test2"}', name: 'search'},
          id: 'call-2',
          type: 'function',
        },
      ])

      const messages = contextManager.getMessages()
      expect(messages[0].toolCalls).to.have.lengthOf(2)
    })

    it('should add assistant message with null content and tool calls', async () => {
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{}', name: 'tool'},
          id: 'call-1',
          type: 'function',
        },
      ])

      const messages = contextManager.getMessages()
      expect(messages[0].content).to.be.null
      expect(messages[0].toolCalls).to.exist
    })
  })

  describe('addSystemMessage', () => {
    it('should add system message to history', async () => {
      await contextManager.addSystemMessage('You are a helpful assistant')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.deep.equal({
        content: 'You are a helpful assistant',
        role: 'system',
      })
    })

    it('should add multiple system messages', async () => {
      await contextManager.addSystemMessage('System message 1')
      await contextManager.addSystemMessage('System message 2')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(2)
      expect(messages[0].content).to.equal('System message 1')
      expect(messages[1].content).to.equal('System message 2')
    })

    it('should handle empty system message', async () => {
      await contextManager.addSystemMessage('')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('')
    })
  })

  describe('addToolResult', () => {
    it('should add tool result to history', async () => {
      const result = await contextManager.addToolResult('call-1', 'search', 'Found 5 files', {
        success: true,
      })

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].role).to.equal('tool')
      expect(messages[0].toolCallId).to.equal('call-1')
      expect(messages[0].name).to.equal('search')
      expect(result).to.be.a('string')
    })

    it('should sanitize tool result to JSON string', async () => {
      const toolResult = {count: 42, data: 'test'}
      await contextManager.addToolResult('call-1', 'tool', toolResult, {success: true})

      const messages = contextManager.getMessages()
      expect(messages[0].content).to.be.a('string')
      expect(messages[0].content).to.include('test')
      expect(messages[0].content).to.include('42')
    })

    it('should handle string tool result', async () => {
      await contextManager.addToolResult('call-1', 'tool', 'plain text result', {success: true})

      const messages = contextManager.getMessages()
      expect(messages[0].content).to.equal('plain text result')
    })

    it('should handle null tool result', async () => {
      await contextManager.addToolResult('call-1', 'tool', null, {success: true})

      const messages = contextManager.getMessages()
      expect(messages[0].content).to.equal('null')
    })

    it('should not truncate large string tool results', async () => {
      const largeResult = 'a'.repeat(100_000)
      await contextManager.addToolResult('call-1', 'tool', largeResult, {success: true})

      const messages = contextManager.getMessages()
      const content = messages[0].content as string
      // String results are stored as-is (not JSON stringified), so no truncation happens for plain strings
      expect(content.length).to.equal(100_000)
    })

    it('should truncate large JSON object tool results', async () => {
      const largeObject = {data: 'x'.repeat(100_000)}
      await contextManager.addToolResult('call-1', 'tool', largeObject, {success: true})

      const messages = contextManager.getMessages()
      const content = messages[0].content as string
      // JSON stringified results get truncated at 50,000 chars
      // Allow some tolerance for JSON formatting (newlines, spaces)
      expect(content.length).to.be.lessThanOrEqual(50_020) // 50,000 + '\n... (truncated)' + some formatting
      expect(content).to.include('(truncated)')
    })

    it('should handle tool result with error metadata', async () => {
      await contextManager.addToolResult('call-1', 'tool', 'error occurred', {
        errorType: 'FileNotFound',
        success: false,
      })

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].role).to.equal('tool')
    })

    it('should be thread-safe for parallel tool results', async () => {
      // Simulate parallel tool execution
      const promises = [
        contextManager.addToolResult('call-1', 'tool1', 'result1', {success: true}),
        contextManager.addToolResult('call-2', 'tool2', 'result2', {success: true}),
        contextManager.addToolResult('call-3', 'tool3', 'result3', {success: true}),
      ]

      await Promise.all(promises)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(3)
      // Verify all results are present
      expect(messages.map((m) => m.toolCallId)).to.include.members(['call-1', 'call-2', 'call-3'])
    })
  })

  describe('message retrieval', () => {
    beforeEach(async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage('Hi there!')
      await contextManager.addSystemMessage('Context')
    })

    it('should return defensive copy in getMessages', () => {
      const messages1 = contextManager.getMessages()
      messages1.push({content: 'injected', role: 'user'})

      const messages2 = contextManager.getMessages()
      expect(messages2).to.have.lengthOf(3)
    })

    it('should return defensive copy in getCuratedMessages', () => {
      const messages1 = contextManager.getCuratedMessages()
      messages1.push({content: 'injected', role: 'user'})

      const messages2 = contextManager.getCuratedMessages()
      expect(messages2).to.have.lengthOf(3)
    })

    it('should return defensive copy in getComprehensiveMessages', () => {
      const messages1 = contextManager.getComprehensiveMessages()
      messages1.push({content: 'injected', role: 'user'})

      const messages2 = contextManager.getComprehensiveMessages()
      expect(messages2).to.have.lengthOf(3)
    })
  })

  describe('clearHistory', () => {
    it('should clear all messages', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addAssistantMessage('Message 2')

      await contextManager.clearHistory()

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(0)
    })

    it('should allow adding messages after clear', async () => {
      await contextManager.addUserMessage('Before clear')
      await contextManager.clearHistory()
      await contextManager.addUserMessage('After clear')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('After clear')
    })

    it('should clear persisted history if storage is enabled', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'test-clear',
        tokenizer,
      })

      await cm.initialize()
      await cm.addUserMessage('Test message')
      await cm.clearHistory()

      const loaded = await historyStorage.loadHistory('test-clear')
      expect(loaded).to.be.undefined
    })
  })

  describe('history persistence', () => {
    it('should persist user message when storage is enabled', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'persist-test',
        tokenizer,
      })

      await cm.initialize()
      await cm.addUserMessage('Persistent message')

      const loaded = await historyStorage.loadHistory('persist-test')
      expect(loaded).to.have.lengthOf(1)
      expect(loaded?.[0].content).to.equal('Persistent message')
    })

    it('should persist assistant message when storage is enabled', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'persist-test',
        tokenizer,
      })

      await cm.initialize()
      await cm.addAssistantMessage('Assistant response')

      const loaded = await historyStorage.loadHistory('persist-test')
      expect(loaded).to.have.lengthOf(1)
      expect(loaded?.[0].content).to.equal('Assistant response')
    })

    it('should persist system message when storage is enabled', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'persist-test',
        tokenizer,
      })

      await cm.initialize()
      await cm.addSystemMessage('System context')

      const loaded = await historyStorage.loadHistory('persist-test')
      expect(loaded).to.have.lengthOf(1)
      expect(loaded?.[0].content).to.equal('System context')
    })

    it('should persist tool result when storage is enabled', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'persist-test',
        tokenizer,
      })

      await cm.initialize()
      await cm.addToolResult('call-1', 'tool', 'result', {success: true})

      const loaded = await historyStorage.loadHistory('persist-test')
      expect(loaded).to.have.lengthOf(1)
      expect(loaded?.[0].role).to.equal('tool')
    })

    it('should not persist when storage is not enabled', async () => {
      await contextManager.addUserMessage('No persistence')

      // No way to verify persistence without storage, just ensure it doesn't throw
      expect(contextManager.getMessages()).to.have.lengthOf(1)
    })
  })

  describe('initialize', () => {
    it('should load persisted history on initialization', async () => {
      const historyStorage = new MockHistoryStorage()

      // Simulate existing history
      await historyStorage.saveHistory('session-1', [
        {content: 'Previous message 1', role: 'user'},
        {content: 'Previous message 2', role: 'assistant'},
      ])

      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'session-1',
        tokenizer,
      })

      const loaded = await cm.initialize()

      expect(loaded).to.be.true
      expect(cm.getMessages()).to.have.lengthOf(2)
      expect(cm.getMessages()[0].content).to.equal('Previous message 1')
    })

    it('should return false when no history exists', async () => {
      const historyStorage = new MockHistoryStorage()
      const cm = new ContextManager({
        formatter,
        historyStorage,
        maxInputTokens: 100_000,
        sessionId: 'new-session',
        tokenizer,
      })

      const loaded = await cm.initialize()

      expect(loaded).to.be.false
      expect(cm.getMessages()).to.have.lengthOf(0)
    })

    it('should return false when storage is not enabled', async () => {
      const loaded = await contextManager.initialize()

      expect(loaded).to.be.false
    })

    it('should not initialize twice', async () => {
      const historyStorage = new MockHistoryStorage()
      const mockLogger: ILogger = {
        debug: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
      }

      const cm = new ContextManager({
        formatter,
        historyStorage,
        logger: mockLogger,
        maxInputTokens: 100_000,
        sessionId: 'session',
        tokenizer,
      })

      await cm.initialize()
      const result = await cm.initialize()

      expect(result).to.be.false
      expect((mockLogger.warn as sinon.SinonStub).calledOnce).to.be.true
    })

    it('should handle initialization errors gracefully', async () => {
      const errorStorage: IHistoryStorage = {
        deleteHistory: sandbox.stub().rejects(new Error('Delete failed')),
        exists: sandbox.stub().rejects(new Error('Exists failed')),
        getSessionMetadata: sandbox.stub().rejects(new Error('Metadata failed')),
        listSessions: sandbox.stub().rejects(new Error('List failed')),
        loadHistory: sandbox.stub().rejects(new Error('Load failed')),
        saveHistory: sandbox.stub().rejects(new Error('Save failed')),
      }

      const cm = new ContextManager({
        formatter,
        historyStorage: errorStorage,
        maxInputTokens: 100_000,
        sessionId: 'error-session',
        tokenizer,
      })

      const loaded = await cm.initialize()

      expect(loaded).to.be.false
      expect(cm.getMessages()).to.have.lengthOf(0)
    })
  })

  describe('getFormattedMessagesWithCompression', () => {
    it('should format messages without system prompt', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage('Hi!')

      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.formattedMessages).to.have.lengthOf(2)
      expect(result.systemPrompt).to.be.undefined
      expect(result.tokensUsed).to.be.greaterThan(0)
      expect(result.messagesFiltered).to.equal(0)
    })

    it('should format messages with system prompt', async () => {
      await contextManager.addUserMessage('Hello')

      const result = await contextManager.getFormattedMessagesWithCompression('You are helpful')

      expect(result.systemPrompt).to.equal('You are helpful')
      expect(result.tokensUsed).to.be.greaterThan(0)
    })

    it('should include token count for system prompt', async () => {
      const result = await contextManager.getFormattedMessagesWithCompression('System prompt text')

      // System prompt tokens should be counted
      expect(result.tokensUsed).to.be.greaterThan(0)
    })

    it('should compress history when exceeding token limit', async () => {
      // Create a context manager with a reasonable token limit
      const cm = new ContextManager({
        formatter,
        maxInputTokens: 200, // Limit to force compression but allow minimum messages
        sessionId: 'compress-test',
        tokenizer,
      })

      // Add many messages to exceed limit
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await cm.addUserMessage(`Message ${i} with some content to increase token count`)
      }

      const result = await cm.getFormattedMessagesWithCompression()

      // Should have fewer messages due to compression
      expect(result.formattedMessages.length).to.be.lessThan(20)
      // Token count should be at or below limit (accounting for minimum message requirements)
      expect(result.tokensUsed).to.be.lessThanOrEqual(250) // Allow some tolerance for minimums
    })

    it('should not compress when within token limit', async () => {
      await contextManager.addUserMessage('Short')
      await contextManager.addAssistantMessage('Reply')

      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.formattedMessages).to.have.lengthOf(2)
    })

    it('should count messagesFiltered correctly', async () => {
      await contextManager.addUserMessage('Hello')
      await contextManager.addAssistantMessage(null) // Invalid - will be filtered
      await contextManager.addAssistantMessage('Valid')

      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.messagesFiltered).to.equal(1)
      expect(result.formattedMessages).to.have.lengthOf(2)
    })
  })

  describe('conversation flow', () => {
    it('should handle realistic user-assistant conversation', async () => {
      await contextManager.addUserMessage('What is the weather?')
      await contextManager.addAssistantMessage('Let me check that for you')
      await contextManager.addUserMessage('Thank you')
      await contextManager.addAssistantMessage('You are welcome!')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(4)
      expect(messages[0].role).to.equal('user')
      expect(messages[1].role).to.equal('assistant')
      expect(messages[2].role).to.equal('user')
      expect(messages[3].role).to.equal('assistant')
    })

    it('should handle conversation with tool use', async () => {
      await contextManager.addUserMessage('Search for files')
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"query": "*.ts"}', name: 'search'},
          id: 'call-1',
          type: 'function',
        },
      ])
      await contextManager.addToolResult('call-1', 'search', 'Found 10 files', {success: true})
      await contextManager.addAssistantMessage('I found 10 TypeScript files')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(4)
      expect(messages[1].toolCalls).to.exist
      expect(messages[2].role).to.equal('tool')
    })

    it('should handle conversation with multiple tool calls', async () => {
      await contextManager.addUserMessage('Read two files')
      await contextManager.addAssistantMessage(null, [
        {
          function: {arguments: '{"path": "a.ts"}', name: 'read'},
          id: 'call-1',
          type: 'function',
        },
        {
          function: {arguments: '{"path": "b.ts"}', name: 'read'},
          id: 'call-2',
          type: 'function',
        },
      ])
      await contextManager.addToolResult('call-1', 'read', 'content of a.ts', {success: true})
      await contextManager.addToolResult('call-2', 'read', 'content of b.ts', {success: true})
      await contextManager.addAssistantMessage('Here are the file contents')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(5)
    })

    it('should handle conversation with system messages', async () => {
      await contextManager.addSystemMessage('Context information')
      await contextManager.addUserMessage('Question')
      await contextManager.addAssistantMessage('Answer')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(3)
      expect(messages[0].role).to.equal('system')
    })
  })

  describe('error handling', () => {
    it('should handle persistence errors gracefully on user message', async () => {
      const errorStorage: IHistoryStorage = {
        deleteHistory: sandbox.stub().rejects(new Error('Delete failed')),
        exists: sandbox.stub().resolves(false),
        getSessionMetadata: sandbox.stub().resolves(),
        listSessions: sandbox.stub().resolves([]),
        loadHistory: sandbox.stub().resolves(),
        saveHistory: sandbox.stub().rejects(new Error('Save failed')),
      }

      const mockLogger: ILogger = {
        debug: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
      }

      const cm = new ContextManager({
        formatter,
        historyStorage: errorStorage,
        logger: mockLogger,
        maxInputTokens: 100_000,
        sessionId: 'error-test',
        tokenizer,
      })

      await cm.initialize()

      // Should not throw, but log error
      await cm.addUserMessage('Test')

      expect(cm.getMessages()).to.have.lengthOf(1)
      // Error should be logged (non-blocking)
    })

    it('should handle persistence errors gracefully on assistant message', async () => {
      const errorStorage: IHistoryStorage = {
        deleteHistory: sandbox.stub().rejects(new Error('Delete failed')),
        exists: sandbox.stub().resolves(false),
        getSessionMetadata: sandbox.stub().resolves(),
        listSessions: sandbox.stub().resolves([]),
        loadHistory: sandbox.stub().resolves(),
        saveHistory: sandbox.stub().rejects(new Error('Save failed')),
      }

      const cm = new ContextManager({
        formatter,
        historyStorage: errorStorage,
        maxInputTokens: 100_000,
        sessionId: 'error-test',
        tokenizer,
      })

      await cm.initialize()
      await cm.addAssistantMessage('Test')

      expect(cm.getMessages()).to.have.lengthOf(1)
    })

    it('should handle circular references in tool results', async () => {
      // Create circular reference
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const circular: any = {name: 'test'}
      circular.self = circular

      const result = await contextManager.addToolResult('call-1', 'tool', circular, {
        success: true,
      })

      expect(result).to.include('serialization failed')
    })
  })

  describe('compressMessage', () => {
    it('should not remove messages when total tokens are within budget', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addUserMessage('Message 2')
      await contextManager.addUserMessage('Message 3')

      const messageTokens = [10, 20, 30] // Total: 60
      contextManager.compressMessage(100, messageTokens) // Budget: 100

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(3)
    })

    it('should remove oldest messages to fit within token budget', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addUserMessage('Message 2')
      await contextManager.addUserMessage('Message 3')
      await contextManager.addUserMessage('Message 4')

      const messageTokens = [30, 30, 30, 30] // Total: 120
      contextManager.compressMessage(70, messageTokens) // Budget: 70, need to remove first 2

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(2)
      expect(messages[0].content).to.equal('Message 3')
      expect(messages[1].content).to.equal('Message 4')
    })

    it('should remove all but one message if budget is very small', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addUserMessage('Message 2')
      await contextManager.addUserMessage('Message 3')

      const messageTokens = [50, 50, 20] // Total: 120
      contextManager.compressMessage(20, messageTokens) // Budget: 20, only last fits

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('Message 3')
    })

    it('should remove all messages if budget is zero', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addUserMessage('Message 2')

      const messageTokens = [50, 50]
      contextManager.compressMessage(0, messageTokens)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(0)
    })

    it('should handle empty messages array', () => {
      contextManager.compressMessage(100, [])

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(0)
    })

    it('should handle single message within budget', async () => {
      await contextManager.addUserMessage('Single message')

      const messageTokens = [50]
      contextManager.compressMessage(100, messageTokens)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].content).to.equal('Single message')
    })

    it('should handle single message exceeding budget', async () => {
      await contextManager.addUserMessage('Single message')

      const messageTokens = [150]
      contextManager.compressMessage(100, messageTokens)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(0)
    })

    it('should remove exact number of messages needed', async () => {
      await contextManager.addUserMessage('Message 1')
      await contextManager.addUserMessage('Message 2')
      await contextManager.addUserMessage('Message 3')
      await contextManager.addUserMessage('Message 4')
      await contextManager.addUserMessage('Message 5')

      const messageTokens = [20, 20, 20, 20, 20] // Total: 100
      contextManager.compressMessage(60, messageTokens) // Need to remove first 2 (40 tokens)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(3)
      expect(messages[0].content).to.equal('Message 3')
    })

    it('should preserve message order after compression', async () => {
      await contextManager.addUserMessage('First')
      await contextManager.addAssistantMessage('Second')
      await contextManager.addUserMessage('Third')
      await contextManager.addAssistantMessage('Fourth')

      const messageTokens = [25, 25, 25, 25] // Total: 100
      contextManager.compressMessage(50, messageTokens) // Keep last 2

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(2)
      expect(messages[0].content).to.equal('Third')
      expect(messages[0].role).to.equal('user')
      expect(messages[1].content).to.equal('Fourth')
      expect(messages[1].role).to.equal('assistant')
    })
  })

  describe('edge cases', () => {
    it('should handle very long conversation history', async () => {
      for (let i = 0; i < 1000; i++) {
        // eslint-disable-next-line no-await-in-loop
        await contextManager.addUserMessage(`Message ${i}`)
      }

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1000)
    })

    it('should handle rapid message additions', async () => {
      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push(contextManager.addUserMessage(`Rapid message ${i}`))
      }

      await Promise.all(promises)

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(100)
    })

    it('should handle empty conversation with formatting', async () => {
      const result = await contextManager.getFormattedMessagesWithCompression()

      expect(result.formattedMessages).to.have.lengthOf(0)
      expect(result.messagesFiltered).to.equal(0)
      expect(result.tokensUsed).to.equal(0)
    })

    it('should handle alternating message types', async () => {
      await contextManager.addUserMessage('User 1')
      await contextManager.addSystemMessage('System 1')
      await contextManager.addAssistantMessage('Assistant 1')
      await contextManager.addUserMessage('User 2')
      await contextManager.addSystemMessage('System 2')

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(5)
      expect(messages.map((m) => m.role)).to.deep.equal([
        'user',
        'system',
        'assistant',
        'user',
        'system',
      ])
    })
  })
})
