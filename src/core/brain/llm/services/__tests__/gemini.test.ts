import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiService } from '../gemini.js';
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

// Mock the GoogleGenAI
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(() => ({
		models: {
			generateContent: vi.fn().mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test response from Gemini' }],
						},
					},
				],
			}),
		},
	})),
	FunctionCallingConfigMode: {
		AUTO: 'AUTO',
		ANY: 'ANY',
		NONE: 'NONE',
	},
}));

describe('GeminiService', () => {
	let geminiService: GeminiService;
	let mockGenAI: any;
	let mockMCPManager: any;
	let mockContextManager: any;
	let mockUnifiedToolManager: any;

	beforeEach(() => {
		mockGenAI = new GoogleGenAI({ apiKey: 'test-api-key' });
		mockMCPManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			executeTool: vi.fn().mockResolvedValue({ result: 'test' }),
		};
		mockContextManager = {
			addUserMessage: vi.fn().mockResolvedValue(undefined),
			addAssistantMessage: vi.fn().mockResolvedValue(undefined),
			addToolResult: vi.fn().mockResolvedValue(undefined),
			getAllFormattedMessages: vi
				.fn()
				.mockResolvedValue([{ role: 'user', parts: [{ text: 'test message' }] }]),
		};
		mockUnifiedToolManager = {
			getToolsForProvider: vi.fn().mockResolvedValue([]),
			executeTool: vi.fn().mockResolvedValue({ result: 'test' }),
			getAllTools: vi.fn().mockResolvedValue({}),
		};

		geminiService = new GeminiService(
			mockGenAI,
			'gemini-pro',
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
	});

	describe('constructor', () => {
		it('should create a GeminiService instance', () => {
			expect(geminiService).toBeInstanceOf(GeminiService);
		});

		it('should initialize with default configuration', () => {
			const service = new GeminiService(
				mockGenAI,
				'gemini-pro',
				mockMCPManager,
				mockContextManager
			);
			expect(service).toBeInstanceOf(GeminiService);
		});

		it('should accept custom configuration', () => {
			const customConfig = {
				toolConfig: {
					mode: FunctionCallingConfigMode.ANY,
					maxFunctionCalls: 3,
					confidenceThreshold: 0.9,
				},
				generationConfig: {
					temperature: 0.5,
					maxOutputTokens: 1024,
				},
			};

			const service = new GeminiService(
				mockGenAI,
				'gemini-pro',
				mockMCPManager,
				mockContextManager,
				5,
				mockUnifiedToolManager,
				customConfig
			);
			expect(service).toBeInstanceOf(GeminiService);
		});
	});

	describe('configuration management', () => {
		it('should update tool configuration', () => {
			const newConfig = {
				mode: FunctionCallingConfigMode.ANY,
				maxFunctionCalls: 3,
			};

			geminiService.updateToolConfig(newConfig);
			// Note: We can't directly test private properties, but the method should not throw
			expect(geminiService.updateToolConfig).toBeDefined();
		});

		it('should update generation configuration', () => {
			const newConfig = {
				temperature: 0.5,
				maxOutputTokens: 1024,
			};

			geminiService.updateGenerationConfig(newConfig);
			// Note: We can't directly test private properties, but the method should not throw
			expect(geminiService.updateGenerationConfig).toBeDefined();
		});
	});

	describe('getConfig', () => {
		it('should return correct configuration', () => {
			const config = geminiService.getConfig();
			expect(config).toEqual({
				provider: 'gemini',
				model: 'gemini-pro',
			});
		});
	});

	describe('getAllTools', () => {
		it('should return tools from unified tool manager when available', async () => {
			const tools = await geminiService.getAllTools();
			expect(mockUnifiedToolManager.getAllTools).toHaveBeenCalled();
		});

		it('should return tools from MCP manager when unified tool manager is not available', async () => {
			const serviceWithoutUnifiedManager = new GeminiService(
				mockGenAI,
				'gemini-pro',
				mockMCPManager,
				mockContextManager,
				5
			);
			await serviceWithoutUnifiedManager.getAllTools();
			expect(mockMCPManager.getAllTools).toHaveBeenCalled();
		});
	});

	describe('directGenerate', () => {
		it('should generate content without context', async () => {
			const result = await geminiService.directGenerate('test input');
			expect(result).toBe('Test response from Gemini');
		});

		it('should handle system prompts', async () => {
			const result = await geminiService.directGenerate('test input', 'system prompt');
			expect(result).toBe('Test response from Gemini');
		});
	});

	describe('generate', () => {
		it('should generate content with context', async () => {
			const result = await geminiService.generate('test input');
			expect(result).toBe('Test response from Gemini');
			expect(mockContextManager.addUserMessage).toHaveBeenCalledWith('test input', undefined);
		});

		it('should handle image data', async () => {
			const imageData = { image: 'test-image', mimeType: 'image/jpeg' };
			await geminiService.generate('test input', imageData);
			expect(mockContextManager.addUserMessage).toHaveBeenCalledWith('test input', imageData);
		});

		it('should use unified tool manager for tool formatting', async () => {
			mockUnifiedToolManager.getToolsForProvider.mockResolvedValue([
				{
					name: 'test_tool',
					description: 'A test tool',
					parametersJsonSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			]);

			await geminiService.generate('test input');
			expect(mockUnifiedToolManager.getToolsForProvider).toHaveBeenCalledWith('gemini');
		});

		it('should fall back to MCP manager when unified tool manager is not available', async () => {
			const serviceWithoutUnifiedManager = new GeminiService(
				mockGenAI,
				'gemini-pro',
				mockMCPManager,
				mockContextManager,
				5
			);

			mockMCPManager.getAllTools.mockResolvedValue({
				test_tool: {
					description: 'A test tool',
					parameters: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			});

			await serviceWithoutUnifiedManager.generate('test input');
			expect(mockMCPManager.getAllTools).toHaveBeenCalled();
		});
	});

	describe('tool filtering', () => {
		it('should filter tools based on user input keywords', async () => {
			// This test would require access to the private filterRelevantTools method
			// For now, we'll test that the service handles tool filtering gracefully
			mockUnifiedToolManager.getToolsForProvider.mockResolvedValue([
				{
					name: 'cipher_memory_search',
					description: 'Search memory for information',
					parametersJsonSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
				{
					name: 'cipher_search_graph',
					description: 'Search knowledge graph',
					parametersJsonSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			]);

			await geminiService.generate('search for information');
			expect(mockUnifiedToolManager.getToolsForProvider).toHaveBeenCalledWith('gemini');
		});
	});

	describe('API configuration', () => {
		it('should use proper API structure with tools', async () => {
			mockUnifiedToolManager.getToolsForProvider.mockResolvedValue([
				{
					name: 'test_tool',
					description: 'A test tool',
					parametersJsonSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			]);

			// Mock the generateContent method to capture the configuration
			const mockGenerateContent = vi.fn().mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test response' }],
						},
					},
				],
			});

			mockGenAI.models.generateContent = mockGenerateContent;

			await geminiService.generate('test input');

			expect(mockGenerateContent).toHaveBeenCalled();
			const callArgs = mockGenerateContent.mock.calls[0][0];
			
			// Verify the API structure includes proper config
			expect(callArgs.model).toBe('gemini-pro');
			expect(callArgs.contents).toBeDefined();
			expect(callArgs.config).toBeDefined();
			expect(callArgs.config.toolConfig).toBeDefined();
			expect(callArgs.config.tools).toBeDefined();
		});

		it('should not include tool config when no tools are available', async () => {
			mockUnifiedToolManager.getToolsForProvider.mockResolvedValue([]);

			const mockGenerateContent = vi.fn().mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test response' }],
						},
					},
				],
			});

			mockGenAI.models.generateContent = mockGenerateContent;

			await geminiService.generate('test input');

			expect(mockGenerateContent).toHaveBeenCalled();
			const callArgs = mockGenerateContent.mock.calls[0][0];
			
			// Verify no tool config is included when no tools are available
			expect(callArgs.model).toBe('gemini-pro');
			expect(callArgs.contents).toBeDefined();
			expect(callArgs.config).toBeUndefined();
		});
	});
});
