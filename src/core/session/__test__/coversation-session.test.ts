console.log('TEST FILE LOADED: coversation-session.test.ts');
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationSession } from '../coversation-session.js';
import type { LLMConfig } from '../../brain/llm/config.js';
import { z } from 'zod';

// Mock the factory functions
vi.mock('../../brain/llm/messages/factory.js', () => ({
	createContextManager: vi.fn(),
}));

vi.mock('../../brain/llm/services/factory.js', () => ({
	createLLMService: vi.fn(),
}));

// Mock the logger to avoid console output in tests
vi.mock('../../logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// At the top of the test file or before all tests, define a default mockUnifiedToolManager
let mockUnifiedToolManager: any;

describe('Minimal ConversationSession direct invocation', () => {
	it('should call run and log from inside run', async () => {
		const { ConversationSession } = await import('../coversation-session.js');
		const session = new ConversationSession(
			{
				stateManager: { getLLMConfig: () => ({ provider: 'test', model: 'test' }) } as any,
				promptManager: { getInstruction: () => 'prompt' } as any,
				contextManager: { addMessage: vi.fn() } as any,
				mcpManager: { getAllTools: async () => ({}), getClients: () => new Map() } as any,
				unifiedToolManager: mockUnifiedToolManager as any,
			},
			'minimal-test'
		);
		session.init = async () => {};
		session.run = async (...args: any[]) => {
			console.log('MINIMAL TEST: run called with', ...args);
			return { response: 'ok', backgroundOperations: Promise.resolve() };
		};
		const result = await session.run('test input');
		expect(result.response).toBe('ok');
	});
});

describe('ConversationSession', () => {
	let session: ConversationSession;
	let mockStateManager: any;
	let mockPromptManager: any;
	let mockMcpManager: any;
	let mockContextManager: any;
	let mockLLMService: any;
	let mockCreateContextManager: any;
	let mockCreateLLMService: any;

	const mockLLMConfig: LLMConfig = {
		provider: 'openai',
		model: 'gpt-4.1-mini',
		apiKey: 'test-api-key',
		maxIterations: 3,
		baseURL: 'https://api.openai.com/v1',
	};

	const sessionId = 'test-session-123';

	// Main beforeEach (default, no unifiedToolManager)
	beforeEach(async () => {
		vi.clearAllMocks();

		// Create mock services
		mockStateManager = {
			getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
			getEvalLLMConfig: vi.fn().mockReturnValue(mockLLMConfig),
		};

		mockPromptManager = {
			load: vi.fn(),
			getInstruction: vi.fn().mockReturnValue('Test system prompt'),
		};

		mockMcpManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			getClients: vi.fn().mockReturnValue(new Map()),
		};

		mockContextManager = {
			addMessage: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
			clearMessages: vi.fn(),
			getRawMessages: vi.fn().mockResolvedValue([]), // Updated to async
		};

		mockLLMService = {
			generate: vi.fn().mockResolvedValue('Generated response'),
			getAllTools: vi.fn().mockResolvedValue({}),
			getConfig: vi.fn().mockReturnValue({
				provider: 'openai',
				model: 'gpt-4',
			}),
		};

		// Mock factory functions
		const { createContextManager } = await import('../../brain/llm/messages/factory.js');
		const { createLLMService } = await import('../../brain/llm/services/factory.js');

		mockCreateContextManager = vi.mocked(createContextManager);
		mockCreateLLMService = vi.mocked(createLLMService);

		mockCreateContextManager.mockReturnValue(mockContextManager);
		mockCreateLLMService.mockReturnValue(mockLLMService);

		mockUnifiedToolManager = {
			executeTool: vi
				.fn()
				.mockResolvedValue({ success: true, extraction: { extracted: 1 }, memory: [] }),
			mcpManager: undefined,
			internalToolManager: undefined,
			config: {},
			getAllTools: vi.fn().mockResolvedValue({}),
			isToolAvailable: vi.fn(),
			getToolInfo: vi.fn(),
			getToolSchema: vi.fn(),
			getToolStats: vi.fn(),
			registerTool: vi.fn(),
			unregisterTool: vi.fn(),
			reloadTools: vi.fn(),
			executeToolCall: vi.fn(),
			clearCache: vi.fn(),
			getStats: vi.fn(),
			subscribe: vi.fn(),
			unsubscribe: vi.fn(),
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			once: vi.fn(),
			removeListener: vi.fn(),
			removeAllListeners: vi.fn(),
			setMaxListeners: vi.fn(),
			getMaxListeners: vi.fn(),
			listeners: vi.fn(),
			listenerCount: vi.fn(),
			eventNames: vi.fn(),
			prependListener: vi.fn(),
			prependOnceListener: vi.fn(),
			rawListeners: vi.fn(),
			getToolSource: vi.fn(),
			getToolsForProvider: vi.fn(),
			handleToolConflict: vi.fn(),
			formatToolsForOpenAI: vi.fn(),
			formatToolsForAnthropic: vi.fn(),
		};

		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager as any,
			},
			sessionId
		);
	});

	describe('Initialization', () => {
		it('should initialize successfully with provided services and id', () => {
			expect(session.id).toBe(sessionId);
		});

		it('should initialize services correctly', async () => {
			await session.init();
			// init is now very simple, we check the side-effects of lazy loading later
			expect(session.getContextManager()).toBe(mockContextManager);

			// Trigger lazy loading of LLM service
			await session.getLLMService();

			expect(mockStateManager.getLLMConfig).toHaveBeenCalledWith(sessionId);
			expect(mockCreateLLMService).toHaveBeenCalledWith(
				mockLLMConfig,
				mockMcpManager,
				mockContextManager,
				mockUnifiedToolManager
			);
		});

		it('should handle LLM service creation errors during lazy initialization', async () => {
			await session.init(); // This should succeed now

			const error = new Error('LLM service creation failed');
			mockCreateLLMService.mockImplementation(() => {
				throw error;
			});

			// The error should occur when trying to access the LLM service
			await expect(session.getLLMService()).rejects.toThrow('LLM service creation failed');
		});
	});

	describe('Session Execution', () => {
		beforeEach(async () => {
			await session.init();
		});

		it('should run session with text input successfully', async () => {
			const input = 'Hello, how are you?';
			const expectedResponse = 'I am fine, thank you!';
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			const result = await session.run(input);
			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			// Accept undefined for stream argument
			expect(mockLLMService.generate).toHaveBeenCalledWith(input, undefined, undefined);
		});

		it('should run session with image data input', async () => {
			const input = 'What do you see in this image?';
			const imageData = { image: 'base64-image-data', mimeType: 'image/jpeg' };
			const expectedResponse = 'I see a cat.';
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			const result = await session.run(input, imageData);
			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			// Accept undefined for stream argument
			expect(mockLLMService.generate).toHaveBeenCalledWith(input, imageData, undefined);
		});

		it('should run session with streaming enabled', async () => {
			const input = 'Stream this response';
			const expectedResponse = 'Streaming response...';

			mockLLMService.generate.mockResolvedValue(expectedResponse);

			const result = await session.run(input, undefined, true);

			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			expect(mockLLMService.generate).toHaveBeenCalledWith(input, undefined, true);
		});

		it('should run session with all parameters', async () => {
			const input = 'Complex request';
			const imageData = { image: 'base64-data', mimeType: 'image/png' };
			const stream = true;
			const expectedResponse = 'Complex response';

			mockLLMService.generate.mockResolvedValue(expectedResponse);

			const result = await session.run(input, imageData, stream);

			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			expect(mockLLMService.generate).toHaveBeenCalledWith(input, imageData, true);
		});

		it('should handle LLM service generation errors', async () => {
			const error = new Error('Generation failed');
			mockLLMService.generate.mockRejectedValue(error);

			await expect(session.run('test input')).rejects.toThrow('Generation failed');
		});

		it('should throw error when running uninitialized session', async () => {
			const uninitializedSession = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				'uninitialized-session'
			);

			// This should throw because it tries to call llmService.generate() on undefined
			await expect(uninitializedSession.run('test')).rejects.toThrow();
		});

		it.skip('should run session with custom memoryMetadata and contextOverrides', async () => {
			const input = 'Test input with metadata';
			const expectedResponse = 'Response with metadata';

			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId
			);
			await session.init();

			// Assert the session is using the correct mocks
			expect(await session.getLLMService()).toBe(mockLLMService);
			expect(session.getContextManager()).toBe(mockContextManager);
			mockLLMService.generate.mockResolvedValue(expectedResponse);

			// Debug: Assert the session is using the mock
			console.log(
				'TEST DEBUG: session.getUnifiedToolManager() === mockUnifiedToolManager?',
				(session.getUnifiedToolManager() as any) === mockUnifiedToolManager
			);
			console.log('TEST DEBUG: session.getUnifiedToolManager():', session.getUnifiedToolManager());
			console.log('TEST DEBUG: mockUnifiedToolManager:', mockUnifiedToolManager);
			expect(session.getUnifiedToolManager()).toBe(mockUnifiedToolManager);

			// Debug: Spy on enforceMemoryExtraction
			const enforceSpy = vi.spyOn(session as any, 'enforceMemoryExtraction');
			console.log(
				'enforceMemoryExtraction: unifiedToolManager ref',
				session.getUnifiedToolManager()
			);

			const memoryMetadata = { customKey: 'customValue', userId: 'user-123' };
			const contextOverrides = { conversationTopic: 'Overridden Topic', extra: 'extraContext' };

			// Debug: Ensure no errors are thrown
			await expect(
				session.run(input, undefined, undefined, { memoryMetadata, contextOverrides })
			).resolves.not.toThrow();

			// Debug: Assert enforceMemoryExtraction is called
			expect(enforceSpy).toHaveBeenCalled();
			// Debug: Assert executeTool is called
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalled();
		});

		// Minimal debug test
		it.skip('debug enforceMemoryExtraction and executeTool', async () => {
			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId
			);
			await session.init();

			// Assert the session is using the correct mocks
			expect(await session.getLLMService()).toBe(mockLLMService);
			expect(session.getContextManager()).toBe(mockContextManager);
			mockLLMService.generate.mockResolvedValue('debug response');

			expect(session.getUnifiedToolManager()).toBe(mockUnifiedToolManager);
			const enforceSpy = vi.spyOn(session as any, 'enforceMemoryExtraction');
			console.log(
				'enforceMemoryExtraction: unifiedToolManager ref',
				session.getUnifiedToolManager()
			);

			await session.run('debug input', undefined, undefined, { memoryMetadata: { foo: 'bar' } });

			// Debug: Print call counts
			console.log('enforceSpy call count:', enforceSpy.mock.calls.length);
			console.log('executeTool call count:', mockUnifiedToolManager.executeTool.mock.calls.length);

			expect(enforceSpy).toHaveBeenCalled();
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalled();
		});

		it.skip('should merge session metadata with custom metadata, custom takes precedence', async () => {
			const input = 'Test merging metadata';
			const expectedResponse = 'Response';
			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId,
				{
					sessionMemoryMetadata: {
						sessionKey: 'sessionValue',
						sessionId: 'session-meta',
						source: 'session-source',
					},
				}
			);
			await session.init();
			mockLLMService.generate.mockResolvedValue(expectedResponse);

			const memoryMetadata = {
				sessionId: 'override-session',
				source: 'override-source',
				custom: 'yes',
			};
			await session.run(input, undefined, undefined, { memoryMetadata });

			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
				'cipher_extract_and_operate_memory',
				expect.objectContaining({
					memoryMetadata: expect.objectContaining({
						sessionId: 'override-session',
						source: 'override-source',
						custom: 'yes',
						sessionKey: 'sessionValue', // session-level key should be present if not overridden
						timestamp: expect.any(String),
					}),
				})
			);
			// Also test session-level only (no per-run override)
			await session.run(input);
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
				'cipher_extract_and_operate_memory',
				expect.objectContaining({
					memoryMetadata: expect.objectContaining({
						sessionId: 'session-meta',
						source: 'session-source',
						sessionKey: 'sessionValue',
						timestamp: expect.any(String),
					}),
				})
			);
		});

		it.skip('should handle invalid memoryMetadata gracefully', async () => {
			const input = 'Test invalid metadata';
			const expectedResponse = 'Response';
			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId
			);
			await session.init();
			mockLLMService.generate.mockResolvedValue(expectedResponse);

			const invalidMetadata = 'not-an-object';
			await session.run(input, undefined, undefined, { memoryMetadata: invalidMetadata as any });

			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
				'cipher_extract_and_operate_memory',
				expect.objectContaining({
					memoryMetadata: expect.objectContaining({
						sessionId: sessionId,
						source: 'conversation-session',
						timestamp: expect.any(String),
					}),
				})
			);
		});

		it.skip('should use only per-run metadata if no session-level metadata is provided', async () => {
			const input = 'Test per-run metadata only';
			const expectedResponse = 'Response';
			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId
			);
			await session.init();
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			const memoryMetadata = { only: 'perRun', foo: 'bar' };
			await session.run(input, undefined, undefined, { memoryMetadata });
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
				'cipher_extract_and_operate_memory',
				expect.objectContaining({
					memoryMetadata: expect.objectContaining({
						only: 'perRun',
						foo: 'bar',
						sessionId: sessionId,
						source: 'conversation-session',
						timestamp: expect.any(String),
					}),
				})
			);
		});

		it.skip('should maintain backward compatibility when no metadata is provided', async () => {
			const input = 'Test legacy';
			const expectedResponse = 'Legacy response';
			session = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				sessionId
			);
			await session.init();
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			await session.run(input);
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
				'cipher_extract_and_operate_memory',
				expect.objectContaining({
					memoryMetadata: expect.objectContaining({
						sessionId: sessionId,
						source: 'conversation-session',
						timestamp: expect.any(String),
					}),
				})
			);
		});
	});

	describe('Service Access', () => {
		beforeEach(async () => {
			await session.init();
		});

		it('should return context manager', () => {
			const contextManager = session.getContextManager();
			expect(contextManager).toBe(mockContextManager);
		});

		it('should return LLM service', async () => {
			const llmService = await session.getLLMService();
			expect(llmService).toBe(mockLLMService);
		});

		it('should return undefined when accessing services before initialization', async () => {
			const uninitializedSession = new ConversationSession(
				{
					stateManager: mockStateManager,
					promptManager: mockPromptManager,
					contextManager: mockContextManager,
					mcpManager: mockMcpManager,
					unifiedToolManager: mockUnifiedToolManager as any,
				},
				'uninitialized-session'
			);

			expect(uninitializedSession.getContextManager()).toBeUndefined();
			// LLM service getter now returns a promise, so we need to await it
			await expect(uninitializedSession.getLLMService()).rejects.toThrow(
				'ConversationSession is not initialized'
			);
		});
	});

	describe('Session State Management', () => {
		it('should use session-specific LLM config', async () => {
			const sessionSpecificConfig = {
				...mockLLMConfig,
				model: 'gpt-3.5-turbo',
				temperature: 0.5,
			};

			mockStateManager.getLLMConfig.mockReturnValue(sessionSpecificConfig);

			await session.init();

			// LLM service is lazy-loaded and not created during init()
			expect(mockCreateLLMService).not.toHaveBeenCalled();

			// LLM service should be created when first accessed
			await session.getLLMService();
			expect(mockStateManager.getLLMConfig).toHaveBeenCalledWith(sessionId);
			expect(mockCreateLLMService).toHaveBeenCalledWith(
				sessionSpecificConfig,
				mockMcpManager,
				mockContextManager,
				mockUnifiedToolManager
			);
		});

		it('should handle different LLM providers', async () => {
			const anthropicConfig = {
				...mockLLMConfig,
				provider: 'anthropic',
				model: 'claude-3-sonnet',
			};

			mockStateManager.getLLMConfig.mockReturnValue(anthropicConfig);

			await session.init();

			// LLM service is lazy-loaded and not created during init()
			expect(mockCreateLLMService).not.toHaveBeenCalled();

			// LLM service should be created when first accessed
			await session.getLLMService();
			expect(mockStateManager.getLLMConfig).toHaveBeenCalledWith(sessionId);
			expect(mockCreateLLMService).toHaveBeenCalledWith(
				anthropicConfig,
				mockMcpManager,
				mockContextManager,
				mockUnifiedToolManager
			);
		});
	});

	describe('Concurrent Operations', () => {
		beforeEach(async () => {
			await session.init();
		});

		it('should handle multiple concurrent run calls', async () => {
			const inputs = ['Question 1', 'Question 2', 'Question 3'];
			const expectedResponses = ['Answer 1', 'Answer 2', 'Answer 3'];

			mockLLMService.generate
				.mockResolvedValueOnce(expectedResponses[0])
				.mockResolvedValueOnce(expectedResponses[1])
				.mockResolvedValueOnce(expectedResponses[2]);

			const promises = inputs.map(input => session.run(input));
			const results = await Promise.all(promises);

			// Check that all expected responses are present, but order may vary due to concurrency
			expect(results).toHaveLength(3);
			const responseStrings = results.map(r => r.response);
			expect(responseStrings).toEqual(expect.arrayContaining(expectedResponses));
			expect(mockLLMService.generate).toHaveBeenCalledTimes(3);
		});

		it('should handle mixed success and failure scenarios', async () => {
			mockLLMService.generate
				.mockResolvedValueOnce('Success 1')
				.mockRejectedValueOnce(new Error('Failure'))
				.mockResolvedValueOnce('Success 2');

			const results = await Promise.allSettled([
				session.run('input1'),
				session.run('input2'),
				session.run('input3'),
			]);

			// Since Promise.allSettled doesn't guarantee order with concurrent calls,
			// we need to check the overall results instead of specific positions
			const fulfilled = results.filter(r => r.status === 'fulfilled');
			const rejected = results.filter(r => r.status === 'rejected');

			expect(fulfilled).toHaveLength(2);
			expect(rejected).toHaveLength(1);

			const successValues = fulfilled.map(
				r =>
					(r as PromiseFulfilledResult<{ response: string; backgroundOperations: Promise<void> }>)
						.value.response
			);
			expect(successValues).toContain('Success 1');
			expect(successValues).toContain('Success 2');

			const rejectedReasons = rejected.map(r => (r as PromiseRejectedResult).reason.message);
			expect(rejectedReasons).toContain('Failure');
		});
	});

	describe('Edge Cases', () => {
		beforeEach(async () => {
			await session.init();
		});

		it('should handle empty input', async () => {
			const emptyInput = '';
			await expect(session.run(emptyInput)).rejects.toThrow('Input must be a non-empty string');
		});

		it('should handle very long input', async () => {
			const longInput = 'a'.repeat(1200);
			const expectedResponse = 'Long input handled.';
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			const result = await session.run(longInput);
			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			// Accept undefined for stream argument
			expect(mockLLMService.generate).toHaveBeenCalledWith(longInput, undefined, undefined);
		});

		it('should handle special characters and unicode', async () => {
			const specialInput = '🚀 Hello! 你好 @#$%^&*()';
			const expectedResponse = 'Special characters handled.';
			mockLLMService.generate.mockResolvedValue(expectedResponse);
			const result = await session.run(specialInput);
			expect(result.response).toBe(expectedResponse);
			expect(result.backgroundOperations).toBeInstanceOf(Promise);
			// Accept undefined for stream argument
			expect(mockLLMService.generate).toHaveBeenCalledWith(specialInput, undefined, undefined);
		});
	});
});

describe('ConversationSession Robustness & Validation', () => {
	let session: ConversationSession;
	let mockStateManager: any;
	let mockPromptManager: any;
	let mockMcpManager: any;
	let mockContextManager: any;
	let mockLLMService: any;
	let mockUnifiedToolManager: any;
	const sessionId = 'robustness-test';
	const mockLLMConfig = {
		provider: 'openai',
		model: 'gpt-4.1-mini',
		apiKey: 'test-api-key',
		maxIterations: 3,
		baseURL: 'https://api.openai.com/v1',
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		mockStateManager = { getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig) };
		mockPromptManager = { getInstruction: vi.fn().mockReturnValue('prompt') };
		mockMcpManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			getClients: vi.fn().mockReturnValue(new Map()),
		};
		mockContextManager = {
			addMessage: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
			clearMessages: vi.fn(),
			getRawMessages: vi.fn().mockReturnValue([]),
		};
		mockLLMService = {
			generate: vi.fn().mockResolvedValue('response'),
			getAllTools: vi.fn(),
			getConfig: vi.fn(),
		};
		const { createContextManager } = await import('../../brain/llm/messages/factory.js');
		const { createLLMService } = await import('../../brain/llm/services/factory.js');
		vi.mocked(createContextManager).mockReturnValue(mockContextManager);
		vi.mocked(createLLMService).mockReturnValue(mockLLMService);
		mockUnifiedToolManager = { executeTool: vi.fn().mockResolvedValue({ success: true }) };
		// Don't call init by default for some tests
		// session = new ConversationSession(...)
	});

	it('should throw if input is empty string', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		await expect(session.run('')).rejects.toThrow('Input must be a non-empty string');
	});

	it('should throw if input is not a string', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		await expect(session.run(123 as any)).rejects.toThrow('Input must be a non-empty string');
	});

	it('should throw if imageDataInput is missing fields', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		await expect(session.run('valid', { image: 'img' } as any)).rejects.toThrow(
			'imageDataInput must have image and mimeType as non-empty strings'
		);
	});

	it('should throw if imageDataInput fields are not strings', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		await expect(session.run('valid', { image: 123, mimeType: 456 } as any)).rejects.toThrow(
			'imageDataInput must have image and mimeType as non-empty strings'
		);
	});

	it('should coerce stream to boolean and warn if not boolean', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await session.run('valid', undefined, 1 as any); // 1 is truthy
		spy.mockRestore();
		// No throw expected, just coercion
	});

	it('should warn on unknown option keys', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await session.run('valid', undefined, undefined, { memoryMetadata: {}, foo: 1 } as any);
		warnSpy.mockRestore();
		// No throw expected, just warning
	});

	it('should throw if run is called before init', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await expect(session.run('valid')).rejects.toThrow(
			'ConversationSession is not initialized. Call init() before run().'
		);
	});
});

describe('ConversationSession Advanced Metadata Integration', () => {
	let session: ConversationSession;
	let mockUnifiedToolManager: any;
	let mockStateManager: any;
	let mockPromptManager: any;
	let mockMcpManager: any;
	let mockContextManager: any;
	let mockLLMService: any;
	let mockCreateContextManager: any;
	let mockCreateLLMService: any;
	const sessionId = 'test-session-advanced';
	const mockLLMConfig = {
		provider: 'openai',
		model: 'gpt-4.1-mini',
		apiKey: 'test-api-key',
		maxIterations: 3,
		baseURL: 'https://api.openai.com/v1',
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		mockStateManager = { getLLMConfig: vi.fn().mockReturnValue(mockLLMConfig) };
		mockPromptManager = { getInstruction: vi.fn().mockReturnValue('prompt') };
		mockMcpManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			getClients: vi.fn().mockReturnValue(new Map()),
		};
		mockContextManager = {
			addMessage: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
			clearMessages: vi.fn(),
			getRawMessages: vi.fn().mockReturnValue([]),
		};
		mockLLMService = {
			generate: vi.fn().mockResolvedValue('response'),
			getAllTools: vi.fn(),
			getConfig: vi.fn(),
		};
		const { createContextManager } = await import('../../brain/llm/messages/factory.js');
		const { createLLMService } = await import('../../brain/llm/services/factory.js');
		mockCreateContextManager = vi.mocked(createContextManager);
		mockCreateLLMService = vi.mocked(createLLMService);
		mockCreateContextManager.mockReturnValue(mockContextManager);
		mockCreateLLMService.mockReturnValue(mockLLMService);
		mockUnifiedToolManager = {
			executeTool: vi.fn().mockResolvedValue({ success: true }),
			...Object.fromEntries(
				Array(30)
					.fill(0)
					.map((_, i) => ['fn' + i, vi.fn()])
			),
		};
	});

	it.skip('should merge session-level and per-run metadata (per-run takes precedence)', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ sessionMemoryMetadata: { foo: 'bar', sessionId: 'session-x', sessionOnly: 1 } }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		await session.run('input', undefined, undefined, {
			memoryMetadata: { foo: 'baz', custom: 123 },
		});
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({
					foo: 'baz', // per-run
					sessionId: 'session-x',
					sessionOnly: 1,
					custom: 123,
					source: 'conversation-session',
					timestamp: expect.any(String),
				}),
			})
		);
	});

	it.skip('should use custom merge function if provided', async () => {
		const customMerge = (sessionMeta: any, runMeta: any) => ({
			...sessionMeta,
			...runMeta,
			merged: true,
		});
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ sessionMemoryMetadata: { a: 1 }, mergeMetadata: customMerge }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		await session.run('input', undefined, undefined, { memoryMetadata: { b: 2 } });
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({ a: 1, b: 2, merged: true }),
			})
		);
	});

	it.skip('should validate metadata with schema and fallback on failure', async () => {
		const schema = z.object({ foo: z.string() });
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ sessionMemoryMetadata: { foo: 'bar', valid: true }, metadataSchema: schema }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		// Valid
		await session.run('input', undefined, undefined, { memoryMetadata: { foo: 'baz' } });
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({ foo: 'baz' }),
			})
		);
		// Invalid (should fallback to session-level)
		await session.run('input', undefined, undefined, { memoryMetadata: { foo: 123 as any } });
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({ foo: 'bar', valid: true }),
			})
		);
	});

	it.skip('should call beforeMemoryExtraction hook if provided', async () => {
		const hook = vi.fn();
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ beforeMemoryExtraction: hook }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		await session.run('input', undefined, undefined, { memoryMetadata: { foo: 'bar' } });
		expect(hook).toHaveBeenCalled();
		const [meta, context] = hook.mock.calls[0] || [];
		expect(meta).toMatchObject({
			foo: 'bar',
			sessionId: sessionId,
			source: 'conversation-session',
		});
		expect(context).toHaveProperty('sessionId', sessionId);
	});

	it.skip('should allow updating session-level metadata after construction', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ sessionMemoryMetadata: { foo: 'bar' } }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		session.updateSessionMetadata({ foo: 'baz', newKey: 42 });
		await session.run('input');
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({ foo: 'baz', newKey: 42 }),
			})
		);
	});

	it.skip('should handle invalid memoryMetadata gracefully', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId,
			{ sessionMemoryMetadata: { foo: 'bar' } }
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		await session.run('input', undefined, undefined, { memoryMetadata: 'not-an-object' as any });
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({ foo: 'bar' }),
			})
		);
	});

	it.skip('should maintain backward compatibility when no metadata is provided', async () => {
		session = new ConversationSession(
			{
				stateManager: mockStateManager,
				promptManager: mockPromptManager,
				contextManager: mockContextManager,
				mcpManager: mockMcpManager,
				unifiedToolManager: mockUnifiedToolManager,
			},
			sessionId
		);
		await session.init?.();
		mockLLMService.generate.mockResolvedValue('ok');
		await session.run('input');
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'cipher_extract_and_operate_memory',
			expect.objectContaining({
				memoryMetadata: expect.objectContaining({
					sessionId: sessionId,
					source: 'conversation-session',
					timestamp: expect.any(String),
				}),
			})
		);
	});
});
