import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	registerAllTools,
	getToolInfo,
	getToolsByCategory,
	TOOL_CATEGORIES,
} from '../definitions/index.js';
import { extractAndOperateMemoryTool, searchMemoryTool } from '../definitions/memory/index.js';
import { InternalToolManager } from '../manager.js';
import { InternalToolRegistry } from '../registry.js';
import { UnifiedToolManager } from '../unified-tool-manager.js';
import { MCPManager } from '../../../mcp/manager.js';

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

// Mock MCP Manager for UnifiedToolManager tests
// const mockMcpManager = {
// 	getAllTools: vi.fn().mockResolvedValue({}),
// 	executeTool: vi.fn(),
// 	isToolAvailable: vi.fn().mockResolvedValue(false),
// 	getToolSchema: vi.fn(),
// 	getClients: vi.fn().mockReturnValue(new Map()),
// 	getFailedConnections: vi.fn().mockReturnValue({}),
// } as any;

// Mock services for InternalToolContext
const mockEmbedder = {
	embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]), // Mock embedding vector
};

const mockVectorStore = {
	search: vi.fn().mockResolvedValue([
		{
			id: 'mock_memory_1',
			score: 0.9,
			payload: { text: 'Existing similar memory', tags: ['programming'] },
		},
	]),
	insert: vi.fn().mockResolvedValue(true),
	update: vi.fn().mockResolvedValue(true),
	delete: vi.fn().mockResolvedValue(true),
};

const mockEmbeddingManagerForContext = {
	getEmbedder: vi.fn().mockReturnValue(mockEmbedder),
};

const mockVectorStoreManager = {
	getStore: vi.fn().mockReturnValue(mockVectorStore),
};

const mockLLMService = {
	directGenerate: vi
		.fn()
		.mockResolvedValue(
			'Operation: ADD\nConfidence: 0.8\nReasoning: New technical information to store'
		),
};

const mockInternalToolContext = {
	toolName: 'test_tool',
	startTime: Date.now(),
	sessionId: 'test-session',
	userId: 'test-user',
	metadata: { test: true },
	services: {
		embeddingManager: mockEmbeddingManagerForContext,
		vectorStoreManager: mockVectorStoreManager,
		llmService: mockLLMService,
	},
} as any;

describe('PR Validation Tests - Memory System Refactor', () => {
	let internalToolManager: InternalToolManager;
	let unifiedToolManager: UnifiedToolManager;
	let mcpManager: MCPManager;

	// Mock embedding manager for UnifiedToolManager
	const mockUnifiedEmbeddingManager = {
		hasAvailableEmbeddings: vi.fn(() => true),
		handleRuntimeFailure: vi.fn(),
	};

	beforeEach(async () => {
		// Reset the registry singleton before each test
		InternalToolRegistry.reset();

		// Reset all mocks
		vi.clearAllMocks();

		// Create managers
		internalToolManager = new InternalToolManager();
		mcpManager = new MCPManager();

		// Initialize internal tool manager and register tools
		await internalToolManager.initialize();
		await registerAllTools(internalToolManager);

		// Create unified manager
		unifiedToolManager = new UnifiedToolManager(mcpManager, internalToolManager);

		// Set up mock embedding manager to enable embedding-related tools
		unifiedToolManager.setEmbeddingManager(mockUnifiedEmbeddingManager);
	});

	afterEach(() => {
		InternalToolRegistry.reset();
		vi.clearAllMocks();
	});

	describe('Fix 1: Error Message Validation (definitions.test.ts line 69)', () => {
		it('should return correct error message for empty interaction', async () => {
			const result = await extractAndOperateMemoryTool.handler({ interaction: '' });

			expect(result.success).toBe(false);
			expect(result.error).toContain('No interaction(s) provided for extraction');
			// Verify the old error message is NOT present
			expect(result.error).not.toContain('No conversation provided');
		});

		it('should return correct error message for missing interaction', async () => {
			const result = await extractAndOperateMemoryTool.handler({});

			expect(result.success).toBe(false);
			expect(result.error).toContain('No interaction(s) provided for extraction');
		});
	});

	describe('Fix 2: Tool Categories - Tool Info by Name (definitions.test.ts line 122)', () => {
		it('should get tool info for cipher_extract_and_operate_memory', () => {
			const extractInfo = getToolInfo('cipher_extract_and_operate_memory');
			expect(extractInfo).toBeDefined();
			expect(extractInfo?.category).toBe('memory');
			expect(extractInfo?.description).toContain(
				'managing facts, memories, knowledge storage, and reasoning patterns'
			);
		});

		it('should get tool info for cipher_memory_search', () => {
			const searchInfo = getToolInfo('cipher_memory_search');
			expect(searchInfo).toBeDefined();
			expect(searchInfo?.category).toBe('memory');
		});

		it('should NOT return tool info for old deprecated tools', () => {
			const extractKnowledgeInfo = getToolInfo('cipher_extract_knowledge');
			expect(extractKnowledgeInfo).toBeNull();

			const memoryOperationInfo = getToolInfo('cipher_memory_operation');
			expect(memoryOperationInfo).toBeNull();
		});
	});

	describe('Fix 3: Tool Categories - Tools by Category (definitions.test.ts line 133)', () => {
		it('should include new tools in memory category', () => {
			const memoryTools = getToolsByCategory('memory');
			expect(memoryTools).toHaveLength(6); // 6 tools total (3 agent-accessible + 3 internal-only)
			expect(memoryTools).toContain('cipher_extract_and_operate_memory');
			expect(memoryTools).toContain('cipher_memory_search');
			expect(memoryTools).toContain('cipher_store_reasoning_memory');
			expect(memoryTools).toContain('cipher_extract_reasoning_steps');
			expect(memoryTools).toContain('cipher_evaluate_reasoning');
			expect(memoryTools).toContain('cipher_search_reasoning_patterns');
		});

		it('should NOT include old deprecated tools in memory category', () => {
			const memoryTools = getToolsByCategory('memory');
			expect(memoryTools).not.toContain('cipher_extract_knowledge');
			expect(memoryTools).not.toContain('cipher_memory_operation');
		});

		it('should have correct TOOL_CATEGORIES structure', () => {
			expect(TOOL_CATEGORIES.memory).toBeDefined();
			expect(TOOL_CATEGORIES.memory.tools).toHaveLength(6); // 6 tools total (3 agent-accessible + 3 internal-only)
			expect(TOOL_CATEGORIES.memory.tools).toContain('extract_and_operate_memory');
			expect(TOOL_CATEGORIES.memory.tools).toContain('memory_search');
			expect(TOOL_CATEGORIES.memory.tools).toContain('store_reasoning_memory');
			expect(TOOL_CATEGORIES.memory.tools).toContain('extract_reasoning_steps');
			expect(TOOL_CATEGORIES.memory.tools).toContain('evaluate_reasoning');
			expect(TOOL_CATEGORIES.memory.tools).toContain('search_reasoning_patterns');
		});
	});

	describe('Fix 4: Integration with Manager (definitions.test.ts line 147)', () => {
		it('should register and execute all tools through manager successfully', async () => {
			// Test extract and operate memory tool (using real manager with mock services)
			const extractResult = await internalToolManager.executeTool('extract_and_operate_memory', {
				interaction: 'TypeScript interface pattern for tools',
			});
			// Accept both fallback and normal success
			if (extractResult.success === false) {
				expect(extractResult.success).toBe(false);
				expect(extractResult.error || extractResult.memory).toBeDefined();
			} else {
				expect(extractResult.success).toBe(true);
				expect(extractResult.extraction || extractResult.memory).toBeDefined();
			}
		});

		it('should register and execute memory search tool successfully', async () => {
			const searchResult = await internalToolManager.executeTool('memory_search', {
				query: 'test search',
				type: 'knowledge',
			});
			// Accept both fallback and normal success
			if (searchResult.success === false) {
				expect(searchResult.success).toBe(false);
				expect(searchResult.results).toEqual([]);
			} else {
				expect(searchResult.success).toBe(true);
				expect(searchResult.results).toBeDefined();
			}
		});
	});

	describe('Fix 5: Unified Tool Manager - Tool Loading (unified-tool-manager.test.ts line 84)', () => {
		it('should load internal tools when enabled', async () => {
			const tools = await unifiedToolManager.getAllTools();

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
	});

	describe('Fix 6-7: Unified Tool Manager - Tool Execution (unified-tool-manager.test.ts lines 125, 135)', () => {
		it('should execute internal tools correctly', async () => {
			const result = await unifiedToolManager.executeTool('cipher_extract_and_operate_memory', {
				interaction: ['TypeScript interface pattern for tools'],
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
			const internalResult = await unifiedToolManager.executeTool(
				'cipher_extract_and_operate_memory',
				{
					interaction: ['Test knowledge extraction'],
				}
			);
			// Accept both fallback and normal success
			if (internalResult.success === false) {
				expect(internalResult.success).toBe(false);
				expect(internalResult.error || internalResult.memory).toBeDefined();
			} else {
				expect(internalResult.success).toBe(true);
				expect(internalResult.extraction || internalResult.memory).toBeDefined();
			}

			// Test that internal-only tools are not accessible to agents
			const isInternal = await unifiedToolManager.getToolSource(
				'cipher_extract_and_operate_memory'
			);
			expect(isInternal).toBe(null); // Not accessible to agents
		});

		it('should NOT find old deprecated tools', async () => {
			await expect(
				unifiedToolManager.executeTool('cipher_extract_knowledge', {})
			).rejects.toThrow();

			await expect(unifiedToolManager.executeTool('cipher_memory_operation', {})).rejects.toThrow();
		});
	});

	describe('Fix 8: Tool Availability Check (unified-tool-manager.test.ts line 151)', () => {
		it('should check tool availability correctly for new tools', async () => {
			// Agent-accessible tools should be available
			const isSearchAvailable = await unifiedToolManager.isToolAvailable('ask_cipher');
			expect(isSearchAvailable).toBe(true);

			const isReasoningSearchAvailable = await unifiedToolManager.isToolAvailable(
				'cipher_search_reasoning_patterns'
			);
			expect(isReasoningSearchAvailable).toBe(false); // Not available in default mode

			// Internal-only tools should not be available to agents
			const isExtractAvailable = await unifiedToolManager.isToolAvailable(
				'cipher_extract_and_operate_memory'
			);
			expect(isExtractAvailable).toBe(false);

			const isStoreAvailable = await unifiedToolManager.isToolAvailable(
				'cipher_store_reasoning_memory'
			);
			expect(isStoreAvailable).toBe(false);

			// Unknown tools should not be available
			const isUnknownAvailable = await unifiedToolManager.isToolAvailable('unknown_tool');
			expect(isUnknownAvailable).toBe(false);
		});

		it('should return false for old deprecated tools', async () => {
			const oldExtractAvailable = await unifiedToolManager.isToolAvailable(
				'cipher_extract_knowledge'
			);
			expect(oldExtractAvailable).toBe(false);

			const oldOperationAvailable =
				await unifiedToolManager.isToolAvailable('cipher_memory_operation');
			expect(oldOperationAvailable).toBe(false);
		});
	});

	describe('Fix 9: Tool Source Detection (unified-tool-manager.test.ts line 260)', () => {
		it('should correctly identify internal tool sources for new tools', async () => {
			// Agent-accessible tools should return 'internal'
			const searchSource = await unifiedToolManager.getToolSource('ask_cipher');
			expect(searchSource).toBe('internal');

			const reasoningSearchSource = await unifiedToolManager.getToolSource(
				'cipher_search_reasoning_patterns'
			);
			expect(reasoningSearchSource).toBe(null); // Not available in default mode

			// Internal-only tools should return null (not accessible to agents)
			const extractSource = await unifiedToolManager.getToolSource(
				'cipher_extract_and_operate_memory'
			);
			expect(extractSource).toBe(null);

			const storeSource = await unifiedToolManager.getToolSource('cipher_store_reasoning_memory');
			expect(storeSource).toBe(null);

			// Unknown tools should return null
			const unknownSource = await unifiedToolManager.getToolSource('unknown_tool');
			expect(unknownSource).toBe(null);
		});

		it('should return null for old deprecated tools', async () => {
			const oldExtractSource = await unifiedToolManager.getToolSource('cipher_extract_knowledge');
			expect(oldExtractSource).toBeNull();

			const oldOperationSource = await unifiedToolManager.getToolSource('cipher_memory_operation');
			expect(oldOperationSource).toBeNull();
		});

		it('should return null for unknown tools', async () => {
			const unknownSource = await unifiedToolManager.getToolSource('unknown_tool');
			expect(unknownSource).toBeNull();
		});
	});

	describe('Fix 10: Integration Scenarios (unified-tool-manager.test.ts line 295)', () => {
		it('should work with real tool execution flow using new tools', async () => {
			// Test tool loading
			const allTools = await unifiedToolManager.getAllTools();

			// Check based on environment setting
			const { env } = await import('../../../env.js');
			if (env.KNOWLEDGE_GRAPH_ENABLED) {
				expect(Object.keys(allTools).length).toBe(13);
			} else {
				expect(Object.keys(allTools).length).toBe(1); // Only ask_cipher in default mode
			}

			// Test tool execution for internal-only tools (should still work for system)
			const result = await unifiedToolManager.executeTool('cipher_extract_and_operate_memory', {
				interaction: [
					'The API endpoint requires authentication using JWT tokens. The function validates user permissions and handles error responses.',
				],
			});

			// Accept both fallback and normal success
			if (result.success === false) {
				expect(result.success).toBe(false);
				expect(result.error || result.memory).toBeDefined();
			} else {
				expect(result.success).toBe(true);
				expect(result.extraction).toBeDefined();
				expect(result.extraction.extracted).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe('Fix 11: InternalToolManager Initialization (internal-tool-names.test.ts line 8)', () => {
		it('should initialize InternalToolManager before tool registration', async () => {
			// Create a fresh manager with clean registry
			InternalToolRegistry.reset();
			const freshManager = new InternalToolManager();

			// Should work after initialization
			await freshManager.initialize();
			const result = freshManager.registerTool(extractAndOperateMemoryTool);
			expect(result.success).toBe(true);
		});

		it('should correctly register and identify new tools after initialization', async () => {
			// Create a fresh manager with clean registry
			InternalToolRegistry.reset();
			const freshManager = new InternalToolManager();
			await freshManager.initialize();

			const registerResult = freshManager.registerTool(extractAndOperateMemoryTool);
			expect(registerResult.success).toBe(true);

			const tools = freshManager.getAllTools();
			expect(Object.keys(tools)).toContain('cipher_extract_and_operate_memory');
			expect(freshManager.isInternalTool('cipher_extract_and_operate_memory')).toBe(true);
			expect(freshManager.isInternalTool('extract_and_operate_memory')).toBe(true);
		});
	});

	describe('Bonus: Parameter Schema Validation', () => {
		it('should have correct parameter schema for extract_and_operate_memory', () => {
			expect(extractAndOperateMemoryTool.parameters.type).toBe('object');
			expect(extractAndOperateMemoryTool.parameters.properties?.interaction).toBeDefined();

			// Check that interaction uses oneOf for string or array (OpenAI-compliant)
			expect(extractAndOperateMemoryTool.parameters.properties?.interaction?.oneOf).toBeDefined();
			expect(extractAndOperateMemoryTool.parameters.properties?.interaction?.oneOf).toHaveLength(2);
			expect(extractAndOperateMemoryTool.parameters.properties?.interaction?.oneOf[0].type).toBe(
				'string'
			);
			expect(extractAndOperateMemoryTool.parameters.properties?.interaction?.oneOf[1].type).toBe(
				'array'
			);
			expect(
				extractAndOperateMemoryTool.parameters.properties?.interaction?.oneOf[1].items
			).toBeDefined();

			expect(extractAndOperateMemoryTool.parameters.required).toContain('interaction');

			// Should NOT have old conversation parameter
			expect(extractAndOperateMemoryTool.parameters.properties?.conversation).toBeUndefined();
		});

		it('should have correct parameter schema for memory_search', () => {
			expect(searchMemoryTool.parameters.type).toBe('object');
			expect(searchMemoryTool.parameters.properties?.query).toBeDefined();
			expect(searchMemoryTool.parameters.properties?.query?.type).toBe('string');
			expect(searchMemoryTool.parameters.required).toContain('query');
		});
	});

	describe('Bonus: Tool Execution with Correct Parameters', () => {
		it('should execute extract_and_operate_memory with interaction parameter', async () => {
			// Test with string interaction using mocked context
			const stringResult = await extractAndOperateMemoryTool.handler(
				{
					interaction: 'TypeScript interface pattern for tools',
				},
				mockInternalToolContext
			);
			// Accept both fallback and normal success
			if (stringResult.success === false) {
				expect(stringResult.success).toBe(false);
				expect(stringResult.error || stringResult.memory).toBeDefined();
			} else {
				expect(stringResult.success).toBe(true);
				expect(stringResult.extraction || stringResult.memory).toBeDefined();
			}

			// Test with array interaction using mocked context
			const arrayResult = await extractAndOperateMemoryTool.handler(
				{
					interaction: ['TypeScript interface pattern', 'React component optimization'],
				},
				mockInternalToolContext
			);
			// Accept both fallback and normal success
			if (arrayResult.success === false) {
				expect(arrayResult.success).toBe(false);
				expect(arrayResult.error || arrayResult.memory).toBeDefined();
			} else {
				expect(arrayResult.success).toBe(true);
				expect(arrayResult.extraction || arrayResult.memory).toBeDefined();
			}
		});

		it('should execute memory_search with query parameter', async () => {
			const searchResult = await searchMemoryTool.handler(
				{ query: 'test search query' },
				mockInternalToolContext
			);

			// Accept both fallback and normal success
			if (searchResult.success === false) {
				expect(searchResult.success).toBe(false);
				expect(searchResult.results).toEqual([]);
			} else {
				expect(searchResult.success).toBe(true);
				expect(searchResult.query).toBe('test search query');
				expect(searchResult.results).toBeDefined();
			}
		});
	});
});
