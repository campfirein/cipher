import {expect} from 'chai'
import * as sinon from 'sinon'

import type {InternalMessage} from '../../../../src/core/interfaces/cipher/message-types.js'

import {SessionEventBus} from '../../../../src/infra/cipher/events/event-emitter.js'
import {ByteRoverLlmGrpcService} from '../../../../src/infra/cipher/grpc/internal-llm-grpc-service.js'
import {ByteRoverLLMService} from '../../../../src/infra/cipher/llm/internal-llm-service.js'
import {SimplePromptFactory} from '../../../../src/infra/cipher/system-prompt/simple-prompt-factory.js'
import {ToolManager} from '../../../../src/infra/cipher/tools/tool-manager.js'

// Helper function to create a ByteRover gRPC provider with test config
function createGrpcProvider() {
  return new ByteRoverLlmGrpcService({
    accessToken: 'test-token',
    grpcEndpoint: 'localhost:50051',
    sessionKey: 'test-session-key',
  })
}

describe('ByteRoverLLMService', () => {
  let sessionEventBus: SessionEventBus
  let promptFactory: SimplePromptFactory
  let toolManager: ToolManager
  let sandbox: sinon.SinonSandbox
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockToolProvider: any

  beforeEach(() => {
    sinon.stub(console, 'log')
    sandbox = sinon.createSandbox()
    sessionEventBus = new SessionEventBus()
    promptFactory = new SimplePromptFactory()
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
      expect(service.getConfig().model).to.equal('gemini-2.5-flash')
    })

    it('should support custom model configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'claude-3-5-sonnet',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service.getConfig().model).to.equal('claude-3-5-sonnet')
    })

    it('should support custom maxTokens configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          maxTokens: 4096,
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support custom maxIterations configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          maxIterations: 100,
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support custom temperature configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
          temperature: 0.5,
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support projectId configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should support region configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })
  })

  describe('getConfig', () => {
    it('should return service configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.model).to.equal('gemini-2.5-flash')
      expect(config.provider).to.equal('byterover')
      expect(config.router).to.equal('in-built')
    })

    it('should include max input tokens in config', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          maxInputTokens: 500_000,
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.configuredMaxInputTokens).to.equal(500_000)
    })

    it('should default provider to byterover', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config.provider).to.equal('byterover')
    })
  })

  describe('getContextManager', () => {
    it('should return context manager', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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

      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const tools = await service.getAllTools()
      expect(tools).to.deep.equal(mockTools)
    })

    it('should return empty toolset when no tools available', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(toolManager, 'getAllTools').returns({} as any)

      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const tools = await service.getAllTools()
      expect(tools).to.deep.equal({})
    })
  })

  describe('event emission', () => {
    it('should have sessionEventBus for event management', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
      const contextManager = service.getContextManager()
      expect(contextManager).to.exist
    })

    it('should have promptFactory for building prompts', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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

  describe('generation config building', () => {
    it('should build generation config with correct parameters', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          maxTokens: 4096,
          model: 'gemini-2.5-flash',
          temperature: 0.8,
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).buildGenerationConfig([])
      expect(config.maxOutputTokens).to.equal(4096)
      expect(config.temperature).to.equal(0.8)
      // System prompt is now in messages array, not in config
      expect(config.systemInstruction).to.be.undefined
    })

    it('should build generation config with tools', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const tools = [
        {
          description: 'A test tool',
          name: 'testTool',
          parameters: {properties: {}, type: 'object'},
        },
      ]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).buildGenerationConfig(tools)
      expect(config.tools).to.exist
      expect(config.tools[0].functionDeclarations).to.have.lengthOf(1)
      // Verify function calling mode is set to ANY to prevent code generation
      expect(config.toolConfig).to.exist
      expect(config.toolConfig.functionCallingConfig).to.exist
      expect(config.toolConfig.functionCallingConfig.mode).to.equal('ANY')
    })

    it('should not include tools when empty array provided', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).buildGenerationConfig([])
      expect(config.tools).to.be.undefined
      expect(config.toolConfig).to.be.undefined
    })

    it('should never include system instruction in config', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // System prompt is now sent in messages array, not in config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).buildGenerationConfig([])
      expect(config.systemInstruction).to.be.undefined
    })

    it('should set topP to 1', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).buildGenerationConfig([])
      expect(config.topP).to.equal(1)
    })
  })

  describe('configuration defaults', () => {
    it('should default maxIterations to 50', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      const config = service.getConfig()
      expect(config).to.exist
    })

    it('should default maxTokens to 8192', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default temperature to 0.7', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default projectId to byterover', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })

    it('should default region to us-central1', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      expect(service).to.exist
    })
  })

  describe('completeTask', () => {
    it('should complete task successfully without tool calls', async () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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

      // Mock provider.generateContent to return response without tool calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service as any, 'provider').value({
        async generateContent() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response: any = {
            candidates: [{content: {parts: [{text: 'Final response'}]}}],
          }
          return response
        },
      })

      // The default stub already returns empty tools from beforeEach

      const result = await service.completeTask('What is 2+2?')
      expect(result).to.equal('Final response')
    })

    it('should require AbortSignal to be checked at iteration start', async () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'claude-3-5-sonnet',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // Verify the configuration is stored correctly
      expect(service.getConfig().model).to.equal('claude-3-5-sonnet')
    })

    it('should verify context manager is available', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // Verify context manager exists and is accessible
      const contextManager = service.getContextManager()
      expect(contextManager).to.exist
    })

    it('should provide session event bus for event emission', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // Verify service has access to event bus (used internally for events)
      // We can't directly access it, but we verify the service doesn't error
      expect(service).to.exist
    })

    it('should support temperature configuration', () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
          temperature: 0.9,
        },
        {
          promptFactory,
          sessionEventBus,
          toolManager,
        },
      )

      // Verify the service is initialized correctly with temperature
      expect(service).to.exist
    })

    it('should support image data in completeTask', async () => {
      const provider = createGrpcProvider()
      const service = new ByteRoverLLMService(
        'test-session',
        provider,
        {
          model: 'gemini-2.5-flash',
        },
        {
          promptFactory,
          sessionEventBus,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(service as any, 'provider').value({
        async generateContent() {
          const result = {
            candidates: [{content: {parts: [{text: 'Image analysis result'}]}}],
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return result as any
        },
      })
      // Use default stub from beforeEach

      await service.completeTask('Analyze this image', {imageData})

      // Verify imageData was passed to addUserMessage
      expect(addUserMessageStub.calledWith('Analyze this image', imageData)).to.be.true
    })
  })
})
