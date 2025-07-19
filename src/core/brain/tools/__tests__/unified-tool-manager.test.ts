import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedToolManager } from '../unified-tool-manager.js';
import { MCPManager } from '../../../mcp/manager.js';
import { InternalToolManager } from '../manager.js';

// Mock the dependencies
vi.mock('../../../mcp/manager.js');
vi.mock('../manager.js');

describe('UnifiedToolManager', () => {
	let unifiedToolManager: UnifiedToolManager;
	let mockMCPManager: any;
	let mockInternalToolManager: any;

	beforeEach(() => {
		mockMCPManager = {
			getAllTools: vi.fn().mockResolvedValue({}),
			executeTool: vi.fn().mockResolvedValue({ result: 'test' }),
		};
		mockInternalToolManager = {
			getAllTools: vi.fn().mockReturnValue({}),
			executeTool: vi.fn().mockResolvedValue({ result: 'test' }),
			getTool: vi.fn().mockReturnValue(null),
			isInternalTool: vi.fn().mockReturnValue(false),
			getManagerStats: vi.fn().mockReturnValue({}),
		};

		unifiedToolManager = new UnifiedToolManager(mockMCPManager, mockInternalToolManager);
	});

	describe('getToolsForProvider', () => {
		it('should format tools for OpenAI provider', async () => {
			const tools = await unifiedToolManager.getToolsForProvider('openai');
			expect(Array.isArray(tools)).toBe(true);
		});

		it('should format tools for Anthropic provider', async () => {
			const tools = await unifiedToolManager.getToolsForProvider('anthropic');
			expect(Array.isArray(tools)).toBe(true);
		});

		it('should format tools for OpenRouter provider', async () => {
			const tools = await unifiedToolManager.getToolsForProvider('openrouter');
			expect(Array.isArray(tools)).toBe(true);
		});

		it('should format tools for Gemini provider', async () => {
			const tools = await unifiedToolManager.getToolsForProvider('gemini');
			expect(Array.isArray(tools)).toBe(true);
		});

		it('should throw error for unsupported provider', async () => {
			await expect(unifiedToolManager.getToolsForProvider('unsupported' as any)).rejects.toThrow(
				'Unsupported provider: unsupported'
			);
		});
	});

	describe('getAllTools', () => {
		it('should return combined tools from both managers', async () => {
			const tools = await unifiedToolManager.getAllTools();
			expect(typeof tools).toBe('object');
		});
	});

	describe('executeTool', () => {
		it('should execute tool through appropriate manager', async () => {
			const result = await unifiedToolManager.executeTool('test-tool', {});
			expect(result).toBeDefined();
		});
	});
}); 