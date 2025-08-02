import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QwenService, QwenOptions } from '../qwen.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';
import { EnhancedPromptManager } from '../../../systemPrompt/enhanced-manager.js';
// import { LLMConfig } from '../../config.js';

// Mock OpenAI client
const mockOpenAI = {
	chat: {
		completions: {
			create: vi.fn(),
		},
	},
};

// Mock MCP Manager
const mockMCPManager = {
	getAllTools: vi.fn().mockResolvedValue([
		{
			name: 'test_file_operation',
			description: 'Test file operation tool',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'File path' },
					operation: { type: 'string', enum: ['read', 'write', 'delete'] },
				},
				required: ['path', 'operation'],
			},
		},
	]),
	executeTool: vi.fn().mockResolvedValue({ success: true, data: 'file content' }),
	getClients: vi.fn().mockReturnValue(new Map()),
	getFailedConnections: vi.fn().mockReturnValue({}),
} as unknown as MCPManager;

// Mock Unified Tool Manager
const mockUnifiedToolManager = {
	getToolsForProvider: vi.fn().mockResolvedValue([
		{
			type: 'function',
			function: {
				name: 'test_file_operation',
				description: 'Test file operation tool',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'File path' },
						operation: { type: 'string', enum: ['read', 'write', 'delete'] },
					},
					required: ['path', 'operation'],
				},
			},
		},
	]),
	executeTool: vi.fn().mockResolvedValue({ success: true, data: 'file content' }),
	getAllTools: vi.fn().mockResolvedValue({
		test_file_operation: {
			description: 'Test file operation tool',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'File path' },
					operation: { type: 'string', enum: ['read', 'write', 'delete'] },
				},
				required: ['path', 'operation'],
			},
			source: 'mcp',
		},
	}),
} as unknown as UnifiedToolManager;

// Mock Context Manager with proper typing
const mockGetFormattedMessage = vi.fn().mockImplementation(message => {
	return Promise.resolve([
		{ role: 'system', content: 'You are a helpful AI assistant.' },
		{ role: 'user', content: message?.content || 'test message' },
	]);
});

const mockContextManager = {
	addUserMessage: vi.fn().mockResolvedValue(undefined),
	addAssistantMessage: vi.fn().mockResolvedValue(undefined),
	addToolResult: vi.fn().mockResolvedValue(undefined),
	getFormattedMessage: mockGetFormattedMessage,
	getAllFormattedMessages: vi.fn().mockResolvedValue([
		{ role: 'system', content: 'You are a helpful AI assistant.' },
		{ role: 'user', content: 'test message' },
	]),
	getRawMessages: vi.fn().mockReturnValue([]),
	getRawMessagesSync: vi.fn().mockReturnValue([]),
	getRawMessagesAsync: vi.fn().mockResolvedValue([]),
} as unknown as ContextManager;

// Mock Prompt Manager
const mockPromptManager = {
	getSystemPrompt: vi.fn().mockReturnValue('You are a helpful AI assistant.'),
	getCompleteSystemPrompt: vi.fn().mockReturnValue('You are a helpful AI assistant.'),
	generateSystemPrompt: vi.fn().mockResolvedValue({
		content: 'You are a helpful AI assistant.',
		providerResults: [],
		generationTimeMs: 0,
		success: true,
		errors: [],
	}),
	updateSystemPrompt: vi.fn(),
	initialize: vi.fn().mockResolvedValue(undefined),
	isInitialized: vi.fn().mockReturnValue(true),
} as unknown as EnhancedPromptManager;

describe('QwenService Integration Tests', () => {
	let qwenService: QwenService;
	let contextManager: ContextManager;
	const mockOptions: QwenOptions = {
		enableThinking: true,
		thinkingBudget: 1000,
		temperature: 0.1,
		top_p: 0.9,
	};

	beforeEach(async () => {
		vi.clearAllMocks();

		// Initialize the mock prompt manager
		await mockPromptManager.initialize();

		// Use mock context manager
		contextManager = mockContextManager;

		// Set up default mock responses
		mockOpenAI.chat.completions.create.mockResolvedValue({
			choices: [
				{
					message: {
						content: 'Default response',
					},
				},
			],
		});

		qwenService = new QwenService(
			mockOpenAI as any,
			'qwen2.5-72b-instruct',
			mockMCPManager,
			contextManager,
			5,
			mockOptions,
			mockUnifiedToolManager
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Full Integration Tests', () => {
		it('should handle complete conversation flow with tool calls', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Read the file and analyze its contents' },
			]);

			// Mock responses: first with tool call, second with final response
			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I need to read a file to help you.',
								tool_calls: [
									{
										id: 'call_1',
										function: {
											name: 'test_file_operation',
											arguments: '{"path": "/test/file.txt", "operation": "read"}',
										},
									},
								],
							},
						},
					],
				},
				{
					choices: [
						{
							message: {
								content:
									'Based on the file content, here is my analysis: The file contains important data.',
							},
						},
					],
				},
			];

			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(mockResponses[callCount++]);
			});

			const result = await qwenService.generate('Read the file and analyze its contents');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith('test_file_operation', {
				path: '/test/file.txt',
				operation: 'read',
			});
			expect(result).toContain('Based on the file content');
		});

		it('should handle multiple tool calls in sequence', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Process the file and write the output' },
			]);

			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I will read the file first.',
								tool_calls: [
									{
										id: 'call_1',
										function: {
											name: 'test_file_operation',
											arguments: '{"path": "/test/file.txt", "operation": "read"}',
										},
									},
								],
							},
						},
					],
				},
				{
					choices: [
						{
							message: {
								content: 'Now I will write the processed data.',
								tool_calls: [
									{
										id: 'call_2',
										function: {
											name: 'test_file_operation',
											arguments: '{"path": "/test/output.txt", "operation": "write"}',
										},
									},
								],
							},
						},
					],
				},
				{
					choices: [
						{
							message: {
								content: 'I have successfully processed the file and written the output.',
							},
						},
					],
				},
			];

			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(mockResponses[callCount++]);
			});

			const result = await qwenService.generate('Process the file and write the output');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(3);
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledTimes(2);
			expect(result).toContain('successfully processed');
		});

		it('should handle tool execution errors gracefully', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Read the file' },
			]);

			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I will try to read the file.',
								tool_calls: [
									{
										id: 'call_1',
										function: {
											name: 'test_file_operation',
											arguments: '{"path": "/nonexistent/file.txt", "operation": "read"}',
										},
									},
								],
							},
						},
					],
				},
				{
					choices: [
						{
							message: {
								content: 'I encountered an error but I can still help you with other tasks.',
							},
						},
					],
				},
			];

			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(mockResponses[callCount++]);
			});

			// Mock tool execution to throw an error
			(mockUnifiedToolManager.executeTool as any).mockRejectedValue(new Error('File not found'));

			const result = await qwenService.generate('Read the file');

			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalled();
			expect(result).toContain('encountered an error');
		});

		it('should respect max iterations limit', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Process this task' },
			]);

			// Mock continuous tool calls to trigger max iterations
			const toolCallResponse = {
				choices: [
					{
						message: {
							content: 'I will continue processing.',
							tool_calls: [
								{
									id: 'call_1',
									function: {
										name: 'test_file_operation',
										arguments: '{"path": "/test/file.txt", "operation": "read"}',
									},
								},
							],
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(toolCallResponse);

			const result = await qwenService.generate('Process this task');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(5); // maxIterations
			expect(result).toContain('reached maximum tool call iterations');
		});

		it('should handle Qwen-specific options correctly', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Analyze this complex problem' },
			]);

			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Test response from Qwen',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			await qwenService.generate('Analyze this complex problem');

			// Verify Qwen-specific options are passed
			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'qwen2.5-72b-instruct',
					enable_thinking: true,
					thinking_budget: 1000,
					temperature: 0.1,
					top_p: 0.9,
				})
			);
		});

		it('should handle direct generation with system prompt', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Test response from Qwen',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await qwenService.directGenerate(
				'Analyze this complex problem',
				'You are a helpful assistant specialized in summarization.'
			);

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'qwen2.5-72b-instruct',
					enable_thinking: true,
					thinking_budget: 1000,
					temperature: 0.1,
					top_p: 0.9,
				})
			);

			expect(result).toBe('Test response from Qwen');
		});

		it('should handle API errors with retry logic', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Test retry logic' },
			]);

			// Mock API error on first call, success on second
			const errorResponse = new Error('API rate limit exceeded');
			(errorResponse as any).status = 429;
			(errorResponse as any).headers = {};

			const successResponse = {
				choices: [
					{
						message: {
							content: 'Success after retry.',
						},
					},
				],
			};

			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				if (callCount === 0) {
					callCount++;
					return Promise.reject(errorResponse);
				}
				return Promise.resolve(successResponse);
			});

			const result = await qwenService.generate('Test retry logic');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
			expect(result).toBe('Success after retry.');
		});

		it('should handle context length exceeded errors', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Test with long context' },
			]);

			const contextError = new Error('Context length exceeded');
			(contextError as any).status = 400;
			(contextError as any).error = {
				code: 'context_length_exceeded',
				message: 'The request exceeds the maximum context length',
			};

			mockOpenAI.chat.completions.create.mockRejectedValue(contextError);

			const result = await qwenService.generate('Test with long context');

			expect(result).toContain('Error processing request');
		});

		it('should format tools correctly for Qwen provider', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Use available tools' },
			]);

			const mockResponse = {
				choices: [
					{
						message: {
							content: 'I will use the available tools.',
							tool_calls: [
								{
									id: 'call_1',
									function: {
										name: 'test_file_operation',
										arguments: '{"path": "/test/file.txt", "operation": "read"}',
									},
								},
							],
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			await qwenService.generate('Use available tools');

			// Verify that getToolsForProvider was called with 'qwen'
			expect(mockUnifiedToolManager.getToolsForProvider).toHaveBeenCalledWith('qwen');
		});

		it('should handle empty tool calls gracefully', async () => {
			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Simple question' },
			]);

			const mockResponse = {
				choices: [
					{
						message: {
							content: 'I can help you without using any tools.',
							// Explicitly set tool_calls to undefined to test graceful handling
							tool_calls: undefined,
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await qwenService.generate('Simple question');

			expect(result).toBe('I can help you without using any tools.');
			expect(mockUnifiedToolManager.executeTool).not.toHaveBeenCalled();
		});

		it('should maintain conversation context across multiple calls', async () => {
			// Setup mock to return different messages for different calls
			let callCount = 0;
			mockGetFormattedMessage.mockImplementation(() => {
				if (callCount === 0) {
					return Promise.resolve([
						{ role: 'system', content: 'You are a helpful AI assistant.' },
						{ role: 'user', content: 'Hello, can you help me?' },
					]);
				} else {
					return Promise.resolve([
						{ role: 'system', content: 'You are a helpful AI assistant.' },
						{ role: 'user', content: 'Hello, can you help me?' },
						{ role: 'assistant', content: 'Hello! How can I help you today?' },
						{ role: 'user', content: 'What did we discuss earlier?' },
					]);
				}
			});

			const responses = [
				{
					choices: [
						{
							message: {
								content: 'Hello! How can I help you today?',
							},
						},
					],
				},
				{
					choices: [
						{
							message: {
								content:
									'I remember you asked about that earlier. Here is the updated information.',
							},
						},
					],
				},
			];

			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(responses[callCount++]);
			});

			// First call
			await qwenService.generate('Hello, can you help me?');

			// Second call - should include context from first call
			const result = await qwenService.generate('What did we discuss earlier?');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
			expect(result).toContain('remember you asked about that earlier');
		});
	});

	describe('Configuration and Setup Tests', () => {
		it('should initialize with correct configuration', () => {
			const config = qwenService.getConfig();
			expect(config).toEqual({
				provider: 'qwen',
				model: 'qwen2.5-72b-instruct',
			});
		});

		it('should handle different Qwen models', async () => {
			const qwenServiceSmall = new QwenService(
				mockOpenAI as any,
				'qwen2.5-7b-instruct',
				mockMCPManager,
				mockContextManager,
				5,
				mockOptions,
				mockUnifiedToolManager
			);

			const config = qwenServiceSmall.getConfig();
			expect(config.model).toBe('qwen2.5-7b-instruct');
		});

		it('should handle different Qwen options', async () => {
			const customOptions: QwenOptions = {
				enableThinking: false,
				thinkingBudget: 500,
				temperature: 0.5,
			};

			// Mock the context manager to return properly formatted messages
			mockGetFormattedMessage.mockResolvedValue([
				{ role: 'system', content: 'You are a helpful AI assistant.' },
				{ role: 'user', content: 'Test' },
			]);

			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Test response from Qwen',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const qwenServiceCustom = new QwenService(
				mockOpenAI as any,
				'qwen2.5-72b-instruct',
				mockMCPManager,
				mockContextManager,
				3,
				customOptions,
				mockUnifiedToolManager
			);

			await qwenServiceCustom.generate('Test');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
				expect.objectContaining({
					enable_thinking: false,
					thinking_budget: 500,
					temperature: 0.5,
				})
			);
		});
	});
});
