import {expect} from 'chai'

import {
  AsyncMutex,
  ContextManager,
  type FileData,
  type FormattedMessagesResult,
  type ImageData,
} from '../../../../../../src/infra/cipher/llm/context/index.js'

describe('Context Module Exports', () => {
  describe('AsyncMutex', () => {
    it('should export AsyncMutex class', () => {
      expect(AsyncMutex).to.exist
      expect(AsyncMutex).to.be.a('function')
    })

    it('should be able to instantiate AsyncMutex', () => {
      const mutex = new AsyncMutex()
      expect(mutex).to.be.instanceOf(AsyncMutex)
    })

    it('should have withLock method', () => {
      const mutex = new AsyncMutex()
      expect(mutex.withLock).to.be.a('function')
    })
  })

  describe('ContextManager', () => {
    it('should export ContextManager class', () => {
      expect(ContextManager).to.exist
      expect(ContextManager).to.be.a('function')
    })

    it('should be able to instantiate ContextManager', () => {
      // Create a minimal formatter for testing
      const mockFormatter = {
        format: () => [],
        parseResponse: () => [],
      }

      // Create a minimal tokenizer for testing
      const mockTokenizer = {
        countTokens: (text: string) => Math.ceil(text.length / 4),
      }

      const contextManager = new ContextManager({
        formatter: mockFormatter,
        maxInputTokens: 100_000,
        sessionId: 'test-session',
        tokenizer: mockTokenizer,
      })

      expect(contextManager).to.be.instanceOf(ContextManager)
    })

    it('should have expected public methods', () => {
      const mockFormatter = {
        format: () => [],
        parseResponse: () => [],
      }

      const mockTokenizer = {
        countTokens: (text: string) => Math.ceil(text.length / 4),
      }

      const contextManager = new ContextManager({
        formatter: mockFormatter,
        maxInputTokens: 100_000,
        sessionId: 'test-session',
        tokenizer: mockTokenizer,
      })

      // Verify key methods exist
      expect(contextManager.addUserMessage).to.be.a('function')
      expect(contextManager.addAssistantMessage).to.be.a('function')
      expect(contextManager.addSystemMessage).to.be.a('function')
      expect(contextManager.addToolResult).to.be.a('function')
      expect(contextManager.getMessages).to.be.a('function')
      expect(contextManager.getCuratedMessages).to.be.a('function')
      expect(contextManager.getComprehensiveMessages).to.be.a('function')
      expect(contextManager.getFormattedMessagesWithCompression).to.be.a('function')
      expect(contextManager.clearHistory).to.be.a('function')
      expect(contextManager.initialize).to.be.a('function')
      expect(contextManager.getSessionId).to.be.a('function')
      expect(contextManager.getMaxInputTokens).to.be.a('function')
    })
  })

  describe('Type Exports', () => {
    it('should export ImageData type', () => {
      // Type-only test - verify compilation
      const imageData: ImageData = {
        data: 'base64string',
        mimeType: 'image/png',
      }

      expect(imageData).to.exist
      expect(imageData.data).to.equal('base64string')
      expect(imageData.mimeType).to.equal('image/png')
    })

    it('should export FileData type', () => {
      // Type-only test - verify compilation
      const fileData: FileData = {
        data: 'file content',
        filename: 'test.txt',
        mimeType: 'text/plain',
      }

      expect(fileData).to.exist
      expect(fileData.data).to.equal('file content')
      expect(fileData.filename).to.equal('test.txt')
      expect(fileData.mimeType).to.equal('text/plain')
    })

    it('should export FormattedMessagesResult type', () => {
      // Type-only test - verify compilation
      const result: FormattedMessagesResult<string> = {
        formattedMessages: ['message1', 'message2'],
        messagesFiltered: 0,
        systemPrompt: 'System prompt',
        tokensUsed: 100,
      }

      expect(result).to.exist
      expect(result.formattedMessages).to.have.lengthOf(2)
      expect(result.messagesFiltered).to.equal(0)
      expect(result.systemPrompt).to.equal('System prompt')
      expect(result.tokensUsed).to.equal(100)
    })

    it('should support FormattedMessagesResult without optional fields', () => {
      // Type-only test - verify compilation
      const result: FormattedMessagesResult<string> = {
        formattedMessages: [],
        messagesFiltered: 0,
        tokensUsed: 0,
      }

      expect(result).to.exist
      expect(result.formattedMessages).to.have.lengthOf(0)
      expect(result.systemPrompt).to.be.undefined
    })

    it('should support ImageData with different data types', () => {
      const imageData1: ImageData = {data: new ArrayBuffer(10)}
      const imageData2: ImageData = {data: Buffer.from('test')}
      const imageData3: ImageData = {data: new Uint8Array(10)}
      const imageData4: ImageData = {data: new URL('https://example.com/image.png')}

      expect(imageData1.data).to.be.instanceOf(ArrayBuffer)
      expect(imageData2.data).to.be.instanceOf(Buffer)
      expect(imageData3.data).to.be.instanceOf(Uint8Array)
      expect(imageData4.data).to.be.instanceOf(URL)
    })

    it('should support FileData with different data types', () => {
      const fileData1: FileData = {data: new ArrayBuffer(10), mimeType: 'application/octet-stream'}
      const fileData2: FileData = {data: Buffer.from('test'), mimeType: 'text/plain'}
      const fileData3: FileData = {data: new Uint8Array(10), mimeType: 'application/octet-stream'}
      const fileData4: FileData = {data: new URL('https://example.com/file.pdf'), mimeType: 'application/pdf'}

      expect(fileData1.data).to.be.instanceOf(ArrayBuffer)
      expect(fileData2.data).to.be.instanceOf(Buffer)
      expect(fileData3.data).to.be.instanceOf(Uint8Array)
      expect(fileData4.data).to.be.instanceOf(URL)
    })
  })

  describe('Module Integration', () => {
    it('should export all expected members', () => {
      // Verify all expected exports are present
      const exports = {
        AsyncMutex,
        ContextManager,
      }

      expect(Object.keys(exports)).to.have.lengthOf(2)
      expect(exports.AsyncMutex).to.exist
      expect(exports.ContextManager).to.exist
    })

    it('should allow creating AsyncMutex and ContextManager together', async () => {
      const mutex = new AsyncMutex()

      const mockFormatter = {
        format: () => [],
        parseResponse: () => [],
      }

      const mockTokenizer = {
        countTokens: (text: string) => Math.ceil(text.length / 4),
      }

      const contextManager = new ContextManager({
        formatter: mockFormatter,
        maxInputTokens: 100_000,
        sessionId: 'test-session',
        tokenizer: mockTokenizer,
      })

      // Test that they can be used together
      await mutex.withLock(async () => {
        await contextManager.addUserMessage('Test message')
      })

      const messages = contextManager.getMessages()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]?.content).to.equal('Test message')
    })
  })
})
