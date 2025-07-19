import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiService } from '../gemini.js';
import { GoogleGenAI } from '@google/genai';
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
			getAllFormattedMessages: vi.fn().mockResolvedValue([
				{ role: 'user', parts: [{ text: 'test message' }] },
			]),
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
	});

	describe('error handling', () => {
		it('should handle API errors gracefully', async () => {
			const mockGenModel = {
				generateContent: vi.fn().mockRejectedValue(new Error('API Error')),
			};
			(mockGenAI.models.generateContent as any).mockRejectedValue(new Error('API Error'));

			const result = await geminiService.generate('test input');
			expect(result).toContain('Error processing request');
		});
	});
}); 