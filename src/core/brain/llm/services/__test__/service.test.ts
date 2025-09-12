import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMServices, type ExtendedLLMConfig, type LLMProviderType } from './../service.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';
import { EventManager } from '../../../../events/event-manager.js';
import { SessionEvents } from '../../../../events/event-types.js';
import { logger } from '../../../../logger/index.js';
import type { ImageData } from '../../messages/types.js';

// Mock dependencies
vi.mock('../../../mcp/manager.js');
vi.mock('../messages/manager.js');
vi.mock('../../tools/unified-tool-manager.js');
vi.mock('../../../events/event-manager.js');
vi.mock('../../../logger/index.js');

// Mock external SDKs
vi.mock('openai', () => ({
	default: vi.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	})),
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: vi.fn().mockImplementation(() => ({
		messages: {
			create: vi.fn(),
		},
	})),
}));

vi.mock('groq-sdk', () => ({
	default: vi.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	})),
}));

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
		getGenerativeModel: vi.fn().mockReturnValue({
			generateContent: vi.fn(),
		}),
	})),
	GenerativeModel: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
	BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
		send: vi.fn(),
	})),
	InvokeModelCommand: vi.fn(),
}));

vi.mock('@azure/openai', () => ({
	OpenAIClient: vi.fn().mockImplementation(() => ({
		getChatCompletions: vi.fn(),
	})),
	AzureKeyCredential: vi.fn(),
}));

// Additional tests for LLMServices, focusing on edge cases and coverage

describe('LLMServices - Additional & Edge Cases', () => {
	let mockMCPManager: MCPManager;
	let mockContextManager: any;
	let mockUnifiedToolManager: any;
	let mockEventManager: EventManager;

	beforeEach(() => {
		vi.clearAllMocks();

		mockMCPManager = {
			getAllTools: vi.fn(),
			executeTool: vi.fn(),
		} as any;

		mockContextManager = {
			addUserMessage: vi.fn(),
			addAssistantMessage: vi.fn(),
			addToolMessage: vi.fn(),
			addToolResult: vi.fn(),
			getFormattedMessage: vi.fn(),
			getAllFormattedMessages: vi.fn(),
			getSystemPrompt: vi.fn(),
			sessionId: 'test-session-123',
		} as any;

		mockUnifiedToolManager = {
			getToolsForProvider: vi.fn().mockResolvedValue([]),
			executeTool: vi.fn(),
			getAllTools: vi.fn().mockResolvedValue({}),
		} as any;

		mockEventManager = {
			emitSessionEvent: vi.fn(),
		} as any;
	});

	it('should handle missing addToolResult gracefully', async () => {
		// Remove addToolResult to simulate legacy context manager
		delete mockContextManager.addToolResult;

		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
			apiKey: 'test-key',
		};

		// Setup proper mock before creating service
		const OpenAI = vi.mocked(await import('openai')).default;
		const mockClient = {
			chat: {
				completions: {
					create: vi
						.fn()
						.mockResolvedValueOnce({
							choices: [
								{
									message: {
										content: 'I need to use a tool',
										tool_calls: [
											{
												id: 'call_123',
												function: {
													name: 'test_tool',
													arguments: '{"param": "value"}',
												},
											},
										],
									},
								},
							],
						})
						.mockResolvedValueOnce({
							choices: [
								{
									message: {
										content: 'Tool execution completed',
										tool_calls: null,
									},
								},
							],
						}),
				},
			},
		};
		(OpenAI as any).mockImplementation(() => mockClient);

		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager,
			mockEventManager
		);

		mockContextManager.getFormattedMessage.mockResolvedValue([]);
		mockContextManager.getSystemPrompt.mockResolvedValue('');
		mockUnifiedToolManager.executeTool.mockResolvedValue({ success: true, result: 'Tool result' });

		// Should fallback gracefully and still return the final response
		const result = await service.generate('Use a tool');
		expect(result).toBe('Tool execution completed');
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'test_tool',
			{ param: 'value' },
			'test-session-123'
		);
	});

	it('should handle missing addToolMessage gracefully', async () => {
		// Remove addToolMessage to simulate legacy context manager
		delete mockContextManager.addToolMessage;

		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
			apiKey: 'test-key',
		};

		// Setup proper mock before creating service
		const OpenAI = vi.mocked(await import('openai')).default;
		const mockClient = {
			chat: {
				completions: {
					create: vi
						.fn()
						.mockResolvedValueOnce({
							choices: [
								{
									message: {
										content: 'I need to use a tool',
										tool_calls: [
											{
												id: 'call_123',
												function: {
													name: 'test_tool',
													arguments: '{"param": "value"}',
												},
											},
										],
									},
								},
							],
						})
						.mockResolvedValueOnce({
							choices: [
								{
									message: {
										content: 'Tool execution completed',
										tool_calls: null,
									},
								},
							],
						}),
				},
			},
		};
		(OpenAI as any).mockImplementation(() => mockClient);

		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager,
			mockEventManager
		);

		mockContextManager.getFormattedMessage.mockResolvedValue([]);
		mockContextManager.getSystemPrompt.mockResolvedValue('');
		mockUnifiedToolManager.executeTool.mockResolvedValue({ success: true, result: 'Tool result' });

		// Should fallback gracefully and still return the final response
		const result = await service.generate('Use a tool');
		expect(result).toBe('Tool execution completed');
		expect(mockUnifiedToolManager.executeTool).toHaveBeenCalledWith(
			'test_tool',
			{ param: 'value' },
			'test-session-123'
		);
	});

	it('should handle missing sessionId in contextManager', async () => {
		mockContextManager.sessionId = undefined;

		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
			apiKey: 'test-key',
		};

		// Setup proper mock before creating service
		const OpenAI = vi.mocked(await import('openai')).default;
		const mockClient = {
			chat: {
				completions: {
					create: vi.fn().mockResolvedValue({
						choices: [{ message: { content: 'No session', tool_calls: null } }],
					}),
				},
			},
		};
		(OpenAI as any).mockImplementation(() => mockClient);

		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager,
			mockEventManager
		);

		mockContextManager.getFormattedMessage.mockResolvedValue([]);
		mockContextManager.getSystemPrompt.mockResolvedValue('');

		const result = await service.generate('Test');
		expect(result).toBe('No session');
		// Should not throw or emit events
	});

	it('should throw if provider is missing in config', () => {
		expect(() => {
			new LLMServices(
				{ model: 'gpt-4' } as any,
				mockMCPManager,
				mockContextManager,
				mockUnifiedToolManager,
				mockEventManager
			);
		}).toThrow('Unsupported LLM provider: undefined');
	});

	it('should throw if model is missing in config', () => {
		expect(() => {
			new LLMServices(
				{ provider: 'openai' } as any,
				mockMCPManager,
				mockContextManager,
				mockUnifiedToolManager,
				mockEventManager
			);
		}).toThrow('Model is required');
	});

	it('should return correct config from getConfig', () => {
		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
		};
		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager
		);
		expect(service.getConfig()).toEqual({ provider: 'openai', model: 'gpt-4' });
	});

	it('should call setEventManager and set eventManager property', () => {
		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
		};
		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager
		);
		service.setEventManager(mockEventManager);
		expect((service as any).eventManager).toBe(mockEventManager);
	});

	it('should get all tools from unified manager', async () => {
		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
		};
		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager
		);
		await service.getAllTools();
		expect(mockUnifiedToolManager.getAllTools).toHaveBeenCalled();
	});

	it('should get formatted tools for provider', async () => {
		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
		};
		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager
		);
		await (service as any).getFormattedTools('openai');
		expect(mockUnifiedToolManager.getToolsForProvider).toHaveBeenCalledWith('openai');
	});

	it('should handle directGenerate errors', async () => {
		const config: ExtendedLLMConfig = {
			provider: 'openai',
			model: 'gpt-4',
		};
		const service = new LLMServices(
			config,
			mockMCPManager,
			mockContextManager,
			mockUnifiedToolManager
		);
		// Simulate error in directGenerate
		service['client'] = {
			chat: {
				completions: {
					create: vi.fn().mockRejectedValue(new Error('direct error')),
				},
			},
		};
		await expect(service.directGenerate('test')).rejects.toThrow('direct error');
	});
});
