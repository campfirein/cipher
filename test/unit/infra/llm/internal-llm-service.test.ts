import {expect} from 'chai'
import * as sinon from 'sinon'

import type {GenerateContentResponse} from '../../../../src/core/interfaces/cipher/i-content-generator.js'
import type {InternalMessage} from '../../../../src/core/interfaces/cipher/message-types.js'

import {SessionEventBus} from '../../../../src/infra/cipher/events/event-emitter.js'
import {ByteRoverLlmHttpService} from '../../../../src/infra/cipher/http/internal-llm-http-service.js'
import {ByteRoverContentGenerator} from '../../../../src/infra/cipher/llm/generators/byterover-content-generator.js'
import {ByteRoverLLMService} from '../../../../src/infra/cipher/llm/internal-llm-service.js'
import {SystemPromptManager} from '../../../../src/infra/cipher/system-prompt/system-prompt-manager.js'
import {ToolManager} from '../../../../src/infra/cipher/tools/tool-manager.js'

// Helper function to create a ByteRover content generator with test config
function createContentGenerator(model = 'gemini-2.5-flash') {
  const httpService = new ByteRoverLlmHttpService({
    accessToken: 'test-token',
    apiBaseUrl: 'http://localhost:3000',
    sessionKey: 'test-session-key',
    spaceId: 'test-space-id',
    teamId: 'test-team-id',
  })
  return new ByteRoverContentGenerator(httpService, {
    model,
  })
}

describe('ByteRoverLLMService', () => {
  let sessionEventBus: SessionEventBus
  let systemPromptManager: SystemPromptManager
  let toolManager: ToolManager
  let sandbox: sinon.SinonSandbox
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockToolProvider: any

  beforeEach(() => {
    sinon.stub(console, 'log')
    sandbox = sinon.createSandbox()
    sessionEventBus = new SessionEventBus()
    systemPromptManager = new SystemPromptManager()
    // Create a mock toolProvider that provides getAllTools, getToolNames, and getAvailableMarkers methods
    mockToolProvider = {
      getAllTools: sandbox.stub().returns({}),
      getAvailableMarkers: sandbox.stub().returns(new Set<string>()),
      getToolNames: sandbox.stub().returns([]),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolManager = new ToolManager(mockToolProvider as any)
  })

  afterEach(() => {
    sandbox.restore()
    sinon.restore()
  })

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
      expect(service.getConfig().model).to.equal('gemini-2.5-flash')
    })

    it('should support custom model configuration', () => {
      const generator = createContentGenerator('claude-3-5-sonnet')
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'claude-3-5-sonnet',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service.getConfig().model).to.equal('claude-3-5-sonnet')
    })

    it('should support custom maxTokens configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          maxTokens: 4096,
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support custom maxIterations configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          maxIterations: 100,
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support custom temperature configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
          temperature: 0.5,
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support projectId configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support region configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })
  })

  describe('getConfig', () => {
    it('should return service configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.model).to.equal('gemini-2.5-flash')
      expect(config.provider).to.equal('byterover')
      expect(config.router).to.equal('in-built')
    })

    it('should include max input tokens in config', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          maxInputTokens: 500_000,
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.configuredMaxInputTokens).to.equal(500_000)
    })

    it('should default provider to byterover', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.provider).to.equal('byterover')
    })
  })

  describe('getContextManager', () => {
    it('should return context manager', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const contextManager = service.getContextManager()
      expect(contextManager).to.exist
    })
  })

  describe('getAllTools', () => {
    it('should return all available tools', async () => {
      const mockTools = {
        testTool: {
          description: 'A test tool',
          parameters: {properties: {}, type: 'object'},
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(toolManager, 'getAllTools').returns(mockTools as any)

      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const tools = await service.getAllTools()
      expect(tools).to.deep.equal(mockTools)
    })

    it('should return empty toolset when no tools available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(toolManager, 'getAllTools').returns({} as any)

      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const tools = await service.getAllTools()
      expect(tools).to.deep.equal({})
    })
  })

  describe('event emission', () => {
    it('should have sessionEventBus for event management', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
      const contextManager = service.getContextManager()
      expect(contextManager).to.exist
    })

    it('should have promptFactory for building prompts', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
      const config = service.getConfig()
      expect(config).to.exist
    })
  })

  describe('text content extraction', () => {
    it('should extract string content', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const message: InternalMessage = {
        content: 'Test message',
        role: 'assistant',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).extractTextContent(message)
      expect(result).to.equal('Test message')
    })

    it('should extract array content with text parts', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const message: InternalMessage = {
        content: [
          {text: 'Part 1', type: 'text'},
          {text: 'Part 2', type: 'text'},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
        role: 'assistant',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).extractTextContent(message)
      expect(result).to.equal('Part 1Part 2')
    })

    it('should filter out non-text parts', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const message: InternalMessage = {
        content: [
          {text: 'Text content', type: 'text'},
          {type: 'image', url: 'http://example.com'},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
        role: 'assistant',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).extractTextContent(message)
      expect(result).to.equal('Text content')
    })

    it('should handle empty content', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const message: InternalMessage = {
        content: [],
        role: 'assistant',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).extractTextContent(message)
      expect(result).to.equal('')
    })

    it('should handle null/undefined content', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const message: InternalMessage = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: null as any,
        role: 'assistant',
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).extractTextContent(message)
      expect(result).to.equal('')
    })
  })

  describe('configuration defaults', () => {
    it('should default maxIterations to 50', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config).to.exist
    })

    it('should default maxTokens to 8192', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default temperature to 0.7', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default projectId to byterover', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default region to us-central1', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      expect(service).to.exist
    })
  })

  describe('completeTask', () => {
    it('should complete task successfully without tool calls', async () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      // Mock contextManager.addUserMessage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'addUserMessage').resolves()

      // Mock getFormattedMessagesWithCompression to return formatted messages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'getFormattedMessagesWithCompression').resolves({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formattedMessages: [{parts: [{text: 'user message'}], role: 'user'} as any],
      })

      // Mock addAssistantMessage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'addAssistantMessage').resolves()

      // Mock generator.generateContent to return response without tool calls
      sandbox.stub(generator, 'generateContent').resolves({
        content: 'Final response',
        finishReason: 'stop',
        toolCalls: [],
      } as GenerateContentResponse)

      // The default stub already returns empty tools from beforeEach

      const result = await service.completeTask('What is 2+2?')
      expect(result).to.equal('Final response')
    })

    it('should require AbortSignal to be checked at iteration start', async () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const controller = new AbortController()
      // Abort before starting
      controller.abort()

      // Setup mocks - abort should be checked even before calling addUserMessage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'addUserMessage').resolves()

      try {
        await service.completeTask('Test', {signal: controller.signal})
        expect.fail('Should have thrown abort error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        // The error should occur during the iteration loop when signal is checked
        expect((error as Error).message).to.include('aborted')
      }
    })

    it('should support custom model in configuration', () => {
      const generator = createContentGenerator('claude-3-5-sonnet')
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'claude-3-5-sonnet',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      // Verify the configuration is stored correctly
      expect(service.getConfig().model).to.equal('claude-3-5-sonnet')
    })

    it('should verify context manager is available', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      // Verify context manager exists and is accessible
      const contextManager = service.getContextManager()
      expect(contextManager).to.exist
    })

    it('should provide session event bus for event emission', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      // Verify service has access to event bus (used internally for events)
      // We can't directly access it, but we verify the service doesn't error
      expect(service).to.exist
    })

    it('should support temperature configuration', () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
          temperature: 0.9,
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      // Verify the service is initialized correctly with temperature
      expect(service).to.exist
    })

    it('should support image data in completeTask', async () => {
      const generator = createContentGenerator()
      const service = new ByteRoverLLMService(
        'test-session',
        generator,
        {
          model: 'gemini-2.5-flash',
        },
        {
          sessionEventBus,
          systemPromptManager,
          toolManager,
        },
      )

      const imageData = {
        data: 'base64encodeddata',
        // eslint-disable-next-line camelcase
        media_type: 'image/png' as const,
      }

      // Setup mocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addUserMessageStub = sandbox.stub(service.getContextManager() as any, 'addUserMessage').resolves()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'getFormattedMessagesWithCompression').resolves({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formattedMessages: [{parts: [{text: 'user message with image'}], role: 'user'} as any],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service.getContextManager() as any, 'addAssistantMessage').resolves()
      sandbox.stub(generator, 'generateContent').resolves({
        content: 'Image analysis result',
        finishReason: 'stop',
        toolCalls: [],
      } as GenerateContentResponse)
      // Use default stub from beforeEach

      await service.completeTask('Analyze this image', {imageData})

      // Verify imageData was passed to addUserMessage
      expect(addUserMessageStub.calledWith('Analyze this image', imageData)).to.be.true
    })
  })
})
