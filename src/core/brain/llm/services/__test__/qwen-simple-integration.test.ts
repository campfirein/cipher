import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QwenService, QwenOptions } from '../qwen.js';

// Mock OpenAI client
const mockOpenAI = {
	chat: {
		completions: {
			create: vi.fn(),
		},
	},
};

// Mock dependencies
const mockMCPManager = {
	getAllTools: vi.fn().mockResolvedValue([]),
	executeTool: vi.fn().mockResolvedValue({ success: true }),
	getClients: vi.fn().mockReturnValue(new Map()),
	getFailedConnections: vi.fn().mockReturnValue({}),
} as any;

const mockContextManager = {
	addUserMessage: vi.fn().mockResolvedValue(undefined),
	addAssistantMessage: vi.fn().mockResolvedValue(undefined),
	addToolResult: vi.fn().mockResolvedValue(undefined),
	getFormattedMessage: vi.fn().mockResolvedValue([{ role: 'user', content: 'test message' }]),
} as any;

const mockUnifiedToolManager = {
	getToolsForProvider: vi.fn().mockResolvedValue([]),
	executeTool: vi.fn().mockResolvedValue({ success: true }),
	getAllTools: vi.fn().mockResolvedValue({}),
} as any;

describe('QwenService Simple Integration Tests', () => {
	let qwenService: QwenService;
	const mockOptions: QwenOptions = {
		enableThinking: true,
		thinkingBudget: 1000,
		temperature: 0.1,
		top_p: 0.9,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		qwenService = new QwenService(
			mockOpenAI as any,
			'qwen2.5-72b-instruct',
			mockMCPManager,
			mockContextManager,
			5,
			mockOptions,
			mockUnifiedToolManager
		);
	});

	describe('Core Functionality Tests', () => {
		it('should handle basic conversation without tool calls', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Hello! I can help you with that.',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await qwenService.generate('Hello, can you help me?');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
			expect(result).toBe('Hello! I can help you with that.');
		});

		it('should handle tool calls successfully', async () => {
			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I will use a tool to help you.',
								tool_calls: [
									{
										id: 'call_1',
										function: {
											name: 'test_tool',
											arguments: '{"param": "value"}',
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
								content: 'Tool executed successfully. Here is the result.',
							},
						},
					],
				},
			];

			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(mockResponses[callCount++]);
			});

			const result = await qwenService.generate('Use a tool to help me');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith('test_tool', {
				param: 'value',
			});
			expect(result).toContain('Tool executed successfully');
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

		it('should handle API errors gracefully', async () => {
			const apiError = new Error('API rate limit exceeded');
			(apiError as any).status = 429;

			mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

			const result = await qwenService.generate('Test error handling');

			expect(result).toContain('Error processing request');
		});

		it('should pass Qwen-specific options correctly', async () => {
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

			await qwenService.generate('Test with Qwen options');

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

		it('should handle different Qwen models', () => {
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
			expect(config.provider).toBe('qwen');
		});

		it('should handle custom Qwen options', async () => {
			const customOptions: QwenOptions = {
				enableThinking: false,
				thinkingBudget: 500,
				temperature: 0.5,
			};

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

		it('should format tools correctly for Qwen provider', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'I will use available tools.',
							tool_calls: [
								{
									id: 'call_1',
									function: {
										name: 'test_tool',
										arguments: '{"param": "value"}',
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
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'I can help you without using any tools.',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await qwenService.generate('Simple question');

			expect(result).toBe('I can help you without using any tools.');
			expect(mockUnifiedToolManager.executeTool).not.toHaveBeenCalled();
		});

		it('should respect max iterations limit', async () => {
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
										name: 'test_tool',
										arguments: '{"param": "value"}',
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

		it('should handle tool execution errors', async () => {
			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I will try to use a tool.',
								tool_calls: [
									{
										id: 'call_1',
										function: {
											name: 'test_tool',
											arguments: '{"param": "value"}',
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
								content: 'I encountered an error but I can still help you.',
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
			(mockUnifiedToolManager.executeTool as any).mockRejectedValue(
				new Error('Tool execution failed')
			);

			const result = await qwenService.generate('Use a tool');

			expect(mockUnifiedToolManager.executeTool).toHaveBeenCalled();
			expect(result).toContain('encountered an error');
		});
	});

	describe('Configuration Tests', () => {
		it('should return correct configuration', () => {
			const config = qwenService.getConfig();
			expect(config).toEqual({
				provider: 'qwen',
				model: 'qwen2.5-72b-instruct',
			});
		});

		it('should handle different Qwen models correctly', () => {
			const models = ['qwen2.5-72b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-7b-instruct'];

			models.forEach(model => {
				const service = new QwenService(
					mockOpenAI as any,
					model,
					mockMCPManager,
					mockContextManager,
					5,
					mockOptions,
					mockUnifiedToolManager
				);

				const config = service.getConfig();
				expect(config.model).toBe(model);
				expect(config.provider).toBe('qwen');
			});
		});
	});
});
