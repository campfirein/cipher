import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepseekService } from '../deepseek.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

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
	executeTool: vi.fn(),
} as unknown as MCPManager;

const mockContextManager = {
	addUserMessage: vi.fn().mockResolvedValue(undefined),
	addAssistantMessage: vi.fn().mockResolvedValue(undefined),
	addToolResult: vi.fn().mockResolvedValue(undefined),
	getFormattedMessage: vi.fn().mockResolvedValue([{ role: 'user', content: 'test message' }]),
} as unknown as ContextManager;

const mockUnifiedToolManager = {
	getToolsForProvider: vi.fn().mockResolvedValue([]),
	executeTool: vi.fn(),
} as unknown as UnifiedToolManager;

describe('DeepseekService', () => {
	let deepseekService: DeepseekService;

	beforeEach(() => {
		vi.clearAllMocks();
		deepseekService = new DeepseekService(
			mockOpenAI as any,
			'deepseek-chat',
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
	});

	describe('constructor', () => {
		it('should create DeepseekService with correct configuration', () => {
			expect(deepseekService).toBeInstanceOf(DeepseekService);
		});
	});

	describe('getConfig', () => {
		it('should return correct configuration', () => {
			const config = deepseekService.getConfig();
			expect(config).toEqual({
				provider: 'deepseek',
				model: 'deepseek-chat',
			});
		});
	});

	describe('directGenerate', () => {
		it('should generate response without conversation context', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Test response from Deepseek',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await deepseekService.directGenerate('test input', 'test system prompt');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
				model: 'deepseek-chat',
				messages: [
					{ role: 'system', content: 'test system prompt' },
					{ role: 'user', content: 'test input' },
				],
			});

			expect(result).toBe('Test response from Deepseek');
		});

		it('should handle errors gracefully', async () => {
			const error = new Error('API Error');
			mockOpenAI.chat.completions.create.mockRejectedValue(error);

			await expect(deepseekService.directGenerate('test input')).rejects.toThrow(
				'[DeepseekService] Direct generate failed: API Error'
			);
		});
	});

	describe('generate', () => {
		it('should handle conversation with tool calls', async () => {
			const mockResponses = [
				{
					choices: [
						{
							message: {
								content: 'I will help you with that',
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
								content: 'Tool result: success',
							},
						},
					],
				},
			];
			let callCount = 0;
			mockOpenAI.chat.completions.create.mockImplementation(() => {
				return Promise.resolve(mockResponses[callCount++]);
			});
			(mockUnifiedToolManager.executeTool as any).mockResolvedValue({ result: 'success' });

			const result = await deepseekService.generate('test input');

			expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
			expect(result).toContain('success');
		});

		it('should handle responses without tool calls', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Simple response from Deepseek',
						},
					},
				],
			};

			mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

			const result = await deepseekService.generate('test input');

			expect(result).toBe('Simple response from Deepseek');
		});
	});
});
