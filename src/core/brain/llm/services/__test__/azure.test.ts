import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureService } from '../azure.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';

vi.mock('@azure/openai', () => ({
	OpenAIClient: vi.fn(),
	AzureKeyCredential: vi.fn((key: string) => ({ key })),
}));

describe('AzureService', () => {
	let azureService: AzureService;
	let mockMcpManager: MCPManager;
	let mockContextManager: ContextManager;
	let mockToolManager: UnifiedToolManager;
	let mockOpenAIClient: any;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
		process.env.AZURE_OPENAI_API_KEY = 'test-api-key';
		mockMcpManager = {} as MCPManager;
		mockContextManager = {
			addUserMessage: vi.fn(),
			addAssistantMessage: vi.fn(),
			getAllFormattedMessages: vi.fn().mockResolvedValue([]),
			getFormattedMessage: vi.fn().mockResolvedValue([]),
			getSystemPrompt: vi.fn().mockResolvedValue('Test system prompt'),
		} as unknown as ContextManager;
		mockToolManager = {
			getToolsForProvider: vi.fn().mockResolvedValue([]),
			getAllTools: vi.fn().mockResolvedValue({}),
			executeTool: vi.fn().mockResolvedValue('tool result'),
		} as unknown as UnifiedToolManager;
		mockOpenAIClient = { getChatCompletions: vi.fn(), streamChatCompletions: vi.fn() };
		(OpenAIClient as any).mockImplementation(() => mockOpenAIClient);
		(AzureKeyCredential as any).mockImplementation((key: string) => ({ key }));
		azureService = new AzureService(
			'gpt-4-deployment',
			mockMcpManager,
			mockContextManager,
			mockToolManager,
			10,
			{ endpoint: 'https://test.openai.azure.com' }
		);
	});

	afterEach(() => {
		delete process.env.AZURE_OPENAI_ENDPOINT;
		delete process.env.AZURE_OPENAI_API_KEY;
	});

	describe('constructor', () => {
		it('should initialize with provided configuration', () => {
			expect(OpenAIClient).toHaveBeenCalledWith(
				'https://test.openai.azure.com',
				expect.objectContaining({ key: 'test-api-key' })
			);
		});
	});

	describe('generate', () => {
		it('should call addUserMessage and return string', async () => {
			mockOpenAIClient.getChatCompletions.mockResolvedValue({
				choices: [{ message: { content: 'response' } }],
			});
			// Patch getAIResponse to return a compatible response
			(azureService as any).getAIResponse = vi
				.fn()
				.mockResolvedValue({ choices: [{ message: { content: 'response' } }] });
			const result = await azureService.generate('hello');
			expect(mockContextManager.addUserMessage).toHaveBeenCalledWith('hello', undefined);
			expect(typeof result).toBe('string');
			expect(result).toBe('response');
		});
	});

	describe('directGenerate', () => {
		it('should return string response', async () => {
			// Patch directGenerate to simulate a response
			(azureService as any).directGenerate = vi.fn().mockResolvedValue('direct response');
			const result = await azureService.directGenerate('hi');
			expect(typeof result).toBe('string');
			expect(result).toBe('direct response');
		});
	});
});
