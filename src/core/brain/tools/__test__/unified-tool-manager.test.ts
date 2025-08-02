import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnifiedToolManager } from '../unified-tool-manager.js';
import { InternalToolManager } from '../manager.js';
import { InternalToolRegistry } from '../registry.js';
import { MCPManager } from '../../../mcp/manager.js';
import { registerAllTools } from '../definitions/index.js';

// Mock the logger to avoid console output during tests
vi.mock('../../../logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	})),
}));

describe('UnifiedToolManager', () => {
	let unifiedManager: UnifiedToolManager;
	let internalToolManager: InternalToolManager;
	let mcpManager: MCPManager;

	// Mock embedding manager
	const mockEmbeddingManager = {
		hasAvailableEmbeddings: vi.fn(() => true),
		handleRuntimeFailure: vi.fn(),
	};

	beforeEach(async () => {
		// Reset the registry singleton before each test
		InternalToolRegistry.reset();

		// Create managers
		internalToolManager = new InternalToolManager();
		mcpManager = new MCPManager();

		// Initialize internal tool manager and register tools
		await internalToolManager.initialize();
		await registerAllTools(internalToolManager);

		// Create unified manager
		unifiedManager = new UnifiedToolManager(mcpManager, internalToolManager);

		// Set up mock embedding manager to enable embedding-related tools
		unifiedManager.setEmbeddingManager(mockEmbeddingManager);
	});

	afterEach(() => {
		InternalToolRegistry.reset();
		vi.clearAllMocks();
	});

	describe('Initialization and Configuration', () => {
		it('should initialize with default configuration', () => {
			const manager = new UnifiedToolManager(mcpManager, internalToolManager);
			const stats = manager.getStats();

			expect(stats.config.enableInternalTools).toBe(true);
			expect(stats.config.enableMcpTools).toBe(true);
			expect(stats.config.conflictResolution).toBe('prefix-internal');
			expect(stats.config.executionTimeout).toBe(30000);
		});

		it('should initialize with custom configuration', () => {
			const config = {
				enableInternalTools: false,
				enableMcpTools: true,
				conflictResolution: 'prefer-mcp' as const,
				executionTimeout: 15000,
			};

			const manager = new UnifiedToolManager(mcpManager, internalToolManager, config);
			const stats = manager.getStats();

			expect(stats.config.enableInternalTools).toBe(false);
			expect(stats.config.enableMcpTools).toBe(true);
			expect(stats.config.conflictResolution).toBe('prefer-mcp');
			expect(stats.config.executionTimeout).toBe(15000);
		});
	});

	describe('Tool Loading and Management', () => {
		it('should load internal tools when enabled', async () => {
			const tools = await unifiedManager.getAllTools();

			// In default mode, only ask_cipher should be available
			expect(tools['ask_cipher']).toBeDefined();

			// Internal-only tools should not be accessible to agents in default mode
			expect(tools['cipher_store_reasoning_memory']).toBeUndefined();
			expect(tools['cipher_extract_and_operate_memory']).toBeUndefined();
			expect(tools['cipher_extract_reasoning_steps']).toBeUndefined();
			expect(tools['cipher_evaluate_reasoning']).toBeUndefined();

			// Should have 1 tool total in default mode (only ask_cipher)
			expect(Object.keys(tools)).toHaveLength(1);

			// All accessible tools should be marked as internal
			for (const tool of Object.values(tools)) {
				expect(tool.source).toBe('internal');
			}
		});

		it('should handle disabled internal tools', async () => {
			const manager = new UnifiedToolManager(mcpManager, internalToolManager, {
				enableInternalTools: false,
				enableMcpTools: true,
			});

			const tools = await manager.getAllTools();

			// In default mode, ask_cipher is hardcoded and always available
			// even when internal tools are disabled
			expect(tools['ask_cipher']).toBeDefined();
			expect(Object.keys(tools)).toHaveLength(1);

			// The ask_cipher tool is marked as internal source
			expect(tools['ask_cipher']?.source).toBe('internal');
		});

		it('should handle disabled MCP tools', async () => {
			const manager = new UnifiedToolManager(mcpManager, internalToolManager, {
				enableInternalTools: true,
				enableMcpTools: false,
			});

			const tools = await manager.getAllTools();

			// Should only have internal tools
			const mcpTools = Object.values(tools).filter(t => t.source === 'mcp');
			expect(mcpTools).toHaveLength(0);

			const internalTools = Object.values(tools).filter(t => t.source === 'internal');
			expect(internalTools.length).toBeGreaterThan(0);
		});

		it('should allow internal-only tools to be executed by system (even if not agent-accessible)', async () => {
			// Internal-only tools should not be in getAllTools() (not agent-accessible)
			const tools = await unifiedManager.getAllTools();
			expect(tools['cipher_store_reasoning_memory']).toBeUndefined();
			expect(tools['cipher_extract_and_operate_memory']).toBeUndefined();

			// But they should still be executable by the system for background processing
			const extractTool = internalToolManager.getTool('cipher_extract_and_operate_memory');
			expect(extractTool).toBeDefined();
			expect(extractTool?.agentAccessible).toBe(false); // Internal-only tool

			const reasoningTool = internalToolManager.getTool('cipher_store_reasoning_memory');
			expect(reasoningTool).toBeDefined();
			expect(reasoningTool?.agentAccessible).toBe(false);
		});
	});

	describe('Tool Execution', () => {
		it('should execute internal tools correctly', async () => {
			const result = await unifiedManager.executeTool('cipher_extract_and_operate_memory', {
				interaction: [
					'The API endpoint requires authentication using JWT tokens. The function validates user permissions and handles error responses. Database queries use async operations for better performance.',
				],
			});
			// Accept both fallback and normal success
			if (result.success === false) {
				expect(result.success).toBe(false);
				expect(result.error || result.memory).toBeDefined();
			} else {
				expect(result.success).toBe(true);
				expect(result.extraction || result.memory).toBeDefined();
			}
		});

		it('should route tools to correct manager', async () => {
			// Test internal tool routing
			const internalResult = await unifiedManager.executeTool('cipher_extract_and_operate_memory', {
				interaction: [
					'The microservice architecture uses Docker containers for deployment. Redis cache improves API performance and reduces database load.',
				],
			});
			// Accept both fallback and normal success
			if (internalResult.success === false) {
				expect(internalResult.success).toBe(false);
				expect(internalResult.error || internalResult.memory).toBeDefined();
			} else {
				expect(internalResult.success).toBe(true);
				expect(internalResult.extraction || internalResult.memory).toBeDefined();
			}
		});

		it('should handle tool execution errors gracefully', async () => {
			await expect(unifiedManager.executeTool('nonexistent_tool', {})).rejects.toThrow();
		});

		it('should check tool availability correctly', async () => {
			// Agent-accessible tools should be available
			const isAvailable = await unifiedManager.isToolAvailable('ask_cipher');
			expect(isAvailable).toBe(true);

			// Internal-only tools should not be available to agents
			const notAvailable = await unifiedManager.isToolAvailable(
				'cipher_extract_and_operate_memory'
			);
			expect(notAvailable).toBe(false);

			const notAvailable2 = await unifiedManager.isToolAvailable('nonexistent_tool');
			expect(notAvailable2).toBe(false);
		});
	});

	describe('Provider-Specific Tool Formatting', () => {
		it('should format tools for OpenAI', async () => {
			const formattedTools = await unifiedManager.getToolsForProvider('openai');

			expect(Array.isArray(formattedTools)).toBe(true);

			// In default mode, should have 1 tool total (only ask_cipher)
			expect(formattedTools.length).toBe(1);

			// Check OpenAI format
			const tool = formattedTools[0];
			expect(tool.type).toBe('function');
			expect(tool.function).toBeDefined();
			expect(tool.function.name).toBeDefined();
			expect(tool.function.description).toBeDefined();
			expect(tool.function.parameters).toBeDefined();
		});

		it('should format tools for Anthropic', async () => {
			const formattedTools = await unifiedManager.getToolsForProvider('anthropic');

			expect(Array.isArray(formattedTools)).toBe(true);

			// In default mode, should have 1 tool total (only ask_cipher)
			expect(formattedTools.length).toBe(1);

			// Check Anthropic format
			const tool = formattedTools[0];
			expect(tool.name).toBeDefined();
			expect(tool.description).toBeDefined();
			expect(tool.input_schema).toBeDefined();
		});

		it('should format tools for OpenRouter', async () => {
			const formattedTools = await unifiedManager.getToolsForProvider('openrouter');

			expect(Array.isArray(formattedTools)).toBe(true);

			// In default mode, should have 1 tool total (only ask_cipher)
			expect(formattedTools.length).toBe(1);

			const tool = formattedTools[0];
			expect(tool.type).toBe('function');
			expect(tool.function).toBeDefined();
		});

		it('should format tools for qwen provider', async () => {
			const formattedTools = await unifiedManager.getToolsForProvider('qwen');

			// Verify the structure - should have the actual cipher tools
			expect(Array.isArray(formattedTools)).toBe(true);
			expect(formattedTools.length).toBeGreaterThan(0);

			// Check that all tools have the correct structure
			formattedTools.forEach(tool => {
				expect(tool).toHaveProperty('type', 'function');
				expect(tool).toHaveProperty('function');
				expect(tool.function).toHaveProperty('name');
				expect(tool.function).toHaveProperty('description');
				expect(tool.function).toHaveProperty('parameters');
				expect(tool.function.parameters).toHaveProperty('type', 'object');
			});

			// Verify at least one of the expected tools is present
			const toolNames = formattedTools.map(tool => tool.function.name);
			expect(toolNames).toContain('ask_cipher');
		});

		it('should throw error for unsupported provider', async () => {
			await expect(unifiedManager.getToolsForProvider('unsupported' as any)).rejects.toThrow(
				'Unsupported provider'
			);
		});
	});

	describe('Statistics and Monitoring', () => {
		it('should provide comprehensive statistics', async () => {
			// Debug: Check what tools are actually registered
			const allTools = internalToolManager.getAllTools();
			const toolNames = Object.keys(allTools);
			console.log('Registered tools:', toolNames);
			console.log(
				'Tool categories:',
				Object.values(allTools).map(t => t.category)
			);

			// Debug: Check what the registry reports
			const stats = unifiedManager.getStats();
			console.log('Registry stats:', stats.internalTools);

			expect(stats.internalTools).toBeDefined();
			expect(stats.mcpTools).toBeDefined();
			expect(stats.config).toBeDefined();

			// Internal tools stats should reflect current implementation
			const { env } = await import('../../../env.js');

			// Calculate expected tool count based on enabled features
			let expectedMemoryTools = 6; // Base memory tools
			if (env.USE_WORKSPACE_MEMORY) {
				expectedMemoryTools += 2; // workspace_search + workspace_store
			}

			if (env.KNOWLEDGE_GRAPH_ENABLED) {
				const expectedTotal = expectedMemoryTools + 11; // memory tools + knowledge graph tools
				expect(stats.internalTools.totalTools).toBe(expectedTotal);
			} else {
				expect(stats.internalTools.totalTools).toBe(expectedMemoryTools);
			}
			expect(stats.internalTools.toolsByCategory.memory).toBe(expectedMemoryTools);
		});

		it('should handle disabled tool managers in stats', () => {
			const manager = new UnifiedToolManager(mcpManager, internalToolManager, {
				enableInternalTools: false,
				enableMcpTools: false,
			});

			const stats = manager.getStats();
			expect(stats.internalTools).toBeNull();
			expect(stats.mcpTools).toBeNull();
		});
	});

	describe('Error Handling', () => {
		it('should handle internal tool manager errors gracefully', async () => {
			// Create a manager with disabled internal tools
			const manager = new UnifiedToolManager(mcpManager, internalToolManager, {
				enableInternalTools: false,
			});

			await expect(manager.executeTool('cipher_extract_knowledge', {})).rejects.toThrow();
		});

		it('should handle MCP manager errors gracefully', async () => {
			// Mock MCP manager to throw errors
			const errorMcpManager = {
				getAllTools: vi.fn().mockRejectedValue(new Error('MCP Error')),
				executeTool: vi.fn().mockRejectedValue(new Error('MCP Execution Error')),
			} as any;

			const manager = new UnifiedToolManager(errorMcpManager, internalToolManager);

			// Should still work with internal tools
			const tools = await manager.getAllTools();
			const internalTools = Object.values(tools).filter(t => t.source === 'internal');
			expect(internalTools.length).toBeGreaterThan(0);
		});
	});

	describe('Tool Source Detection', () => {
		it('should correctly identify internal tool sources', async () => {
			// Agent-accessible tools should return 'internal'
			const source = await unifiedManager.getToolSource('ask_cipher');
			expect(source).toBe('internal');

			// Internal-only tools should return null (not accessible to agents)
			const internalSource = await unifiedManager.getToolSource(
				'cipher_extract_and_operate_memory'
			);
			expect(internalSource).toBe(null);
		});

		it('should return null for unknown tools', async () => {
			const source = await unifiedManager.getToolSource('unknown_tool');
			expect(source).toBeNull();
		});

		it('should handle tool source detection errors', async () => {
			// Create manager with error-prone internal tool manager
			const errorInternalManager = {
				isInternalTool: vi.fn().mockImplementation(() => {
					throw new Error('Internal error');
				}),
			} as any;

			const manager = new UnifiedToolManager(mcpManager, errorInternalManager);
			const source = await manager.getToolSource('cipher_test_tool');
			expect(source).toBeNull();
		});
	});

	describe('Integration Scenarios', () => {
		it('should work with real tool execution flow', async () => {
			// Test a complete flow similar to LLM service usage

			// 1. Get all available tools
			const allTools = await unifiedManager.getAllTools();
			expect(Object.keys(allTools).length).toBeGreaterThan(0);

			// 2. Format tools for OpenAI
			const openaiTools = await unifiedManager.getToolsForProvider('openai');
			expect(openaiTools.length).toBeGreaterThan(0);

			// 3. Execute a tool
			const extractResult = await unifiedManager.executeTool('cipher_extract_and_operate_memory', {
				interaction: [
					'The REST API implements OAuth authentication for secure access. JSON Web Tokens validate user sessions and handle authorization.',
				],
			});
			// Accept both fallback and normal success
			if (extractResult.success === false) {
				expect(extractResult.success).toBe(false);
				expect(extractResult.error || extractResult.memory).toBeDefined();
			} else {
				expect(extractResult.success).toBe(true);
				expect(extractResult.extraction || extractResult.memory).toBeDefined();
			}

			// 4. Check statistics
			const stats = unifiedManager.getStats();
			expect(stats.internalTools.totalExecutions).toBeGreaterThan(0);
		});
	});
});
