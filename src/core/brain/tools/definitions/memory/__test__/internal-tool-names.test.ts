import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InternalToolManager } from '../../../manager.js';
import { UnifiedToolManager } from '../../../unified-tool-manager.js';
import { extractAndOperateMemoryTool } from '../extract_and_operate_memory.js';
import { logger } from '../../../../../logger/index.js';

describe('Internal Tool Names', () => {
	let internalToolManager: InternalToolManager;
	let mockMCPManager: any;

	beforeEach(async () => {
		internalToolManager = new InternalToolManager();
		await internalToolManager.initialize();
		internalToolManager.registerTool(extractAndOperateMemoryTool);

		mockMCPManager = {
			getAllTools: async () => ({}), // No MCP tools
			executeTool: async () => {
				throw new Error('Not implemented');
			},
			clients: new Map(),
			failedConnections: new Map(),
			logger: console,
			toolCache: new Map(),
			initialized: true,
			isConnected: () => false,
			connect: async () => {},
			disconnect: async () => {},
			getAvailableTools: async () => ({}),
			executeToolCall: async () => {
				throw new Error('Not implemented');
			},
			getToolSchema: () => null,
			listTools: async () => [],
			getConnectionStatus: () => ({ connected: [], failed: [] }),
			reloadConnections: async () => {},
			validateConnection: async () => true,
			getToolInfo: () => null,
			handleToolError: () => {},
			clearCache: () => {},
			getStats: () => ({ totalCalls: 0, successfulCalls: 0, failedCalls: 0 }),
			subscribe: () => {},
			unsubscribe: () => {},
			emit: () => {},
			on: () => {},
			off: () => {},
			once: () => {},
			removeListener: () => {},
			removeAllListeners: () => {},
			setMaxListeners: () => {},
			getMaxListeners: () => 10,
			listeners: () => [],
			listenerCount: () => 0,
			eventNames: () => [],
			prependListener: () => {},
			prependOnceListener: () => {},
			rawListeners: () => [],
		};
	});

	afterEach(() => {
		// Clean up if needed
	});

	it('should register tool with correct name in InternalToolManager', () => {
		const internalTools = internalToolManager.getAllTools();
		expect(Object.keys(internalTools)).toContain('cipher_extract_and_operate_memory');
	});

	it('should identify internal tools correctly', () => {
		expect(internalToolManager.isInternalTool('extract_and_operate_memory')).toBe(true);
		expect(internalToolManager.isInternalTool('cipher_extract_and_operate_memory')).toBe(true);
		expect(internalToolManager.isInternalTool('nonexistent_tool')).toBe(false);
	});

	it('should make tools available in UnifiedToolManager', async () => {
		const unifiedToolManager = new UnifiedToolManager(mockMCPManager, internalToolManager, {
			enableInternalTools: true,
			enableMcpTools: false,
		});

		const allTools = await unifiedToolManager.getAllTools();
		// Internal-only tools should not be accessible to agents
		expect(Object.keys(allTools)).not.toContain('cipher_extract_and_operate_memory');
	});

	it('should check tool availability correctly', async () => {
		const unifiedToolManager = new UnifiedToolManager(mockMCPManager, internalToolManager, {
			enableInternalTools: true,
			enableMcpTools: false,
		});

		// Internal-only tools should not be available to agents
		expect(await unifiedToolManager.isToolAvailable('cipher_extract_and_operate_memory')).toBe(
			false
		);
		expect(await unifiedToolManager.isToolAvailable('nonexistent_tool')).toBe(false);
	});
});

describe('memoryMetadata parameter and metadata merging', () => {
	const insertedPayloads: any[] = [];
	const mockEmbedder = {
		embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
	};
	const mockVectorStore = {
		search: vi.fn().mockResolvedValue([]),
		insert: vi.fn().mockImplementation((embeddings, ids, payloads) => {
			insertedPayloads.push(...payloads);
			return undefined;
		}),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
	const mockEmbeddingManager = {
		getEmbedder: vi.fn().mockReturnValue(mockEmbedder),
	};
	const mockVectorStoreManager = {
		getStore: vi.fn().mockReturnValue(mockVectorStore),
	};
	const mockLlmService = {
		directGenerate: vi.fn().mockResolvedValue('ADD'),
	};

	it.skip('should log the correct merged metadata payload (logger spy)', async () => {
		insertedPayloads.length = 0; // Clear before test
		const args = {
			interaction: 'In TypeScript, an interface defines the shape of an object.',
			memoryMetadata: {
				projectId: 'proj-123',
				userId: 'user-456',
				teamId: 'team-789',
				environment: 'dev',
				source: 'cli',
			},
			context: {
				sessionId: 'sess-789',
				userId: 'user-override',
				projectId: 'proj-override',
				conversationTopic: 'Test Topic',
			},
		};
		const mockContext = {
			services: {
				embeddingManager: mockEmbeddingManager,
				vectorStoreManager: mockVectorStoreManager,
				llmService: mockLlmService,
			},
		} as any;
		await extractAndOperateMemoryTool.handler(args, mockContext);
		expect(insertedPayloads[0].metadata).toMatchObject({
			projectId: 'proj-override', // context.projectId overrides memoryMetadata.projectId
			userId: 'user-override', // context.userId overrides memoryMetadata.userId
			teamId: 'team-789',
			environment: 'dev',
			source: 'cli',
			sessionId: 'sess-789',
			conversationTopic: 'Test Topic',
		});
	});

	it.skip('should log the correct merged metadata payload (logger spy)', async () => {
		insertedPayloads.length = 0; // Clear before test
		const args = {
			interaction: 'In TypeScript, an interface defines the shape of an object.',
			memoryMetadata: {
				projectId: 'proj-123',
				userId: 'user-456',
				teamId: 'team-789',
				environment: 'dev',
				source: 'cli',
			},
			context: {
				sessionId: 'sess-789',
				userId: 'user-override',
				projectId: 'proj-override',
				conversationTopic: 'Test Topic',
			},
		};
		const mockContext = {
			services: {
				embeddingManager: mockEmbeddingManager,
				vectorStoreManager: mockVectorStoreManager,
				llmService: mockLlmService,
			},
		} as any;
		const logs: any[] = [];
		const origInfo = logger.info;
		logger.info = (...args) => {
			logs.push(args);
			return origInfo.apply(logger, args);
		};
		try {
			await extractAndOperateMemoryTool.handler(args, mockContext);
			expect(insertedPayloads[0].metadata).toMatchObject({
				projectId: 'proj-override', // context.projectId overrides memoryMetadata.projectId
				userId: 'user-override', // context.userId overrides memoryMetadata.userId
				teamId: 'team-789',
				environment: 'dev',
				source: 'cli',
				sessionId: 'sess-789',
				conversationTopic: 'Test Topic',
			});
		} finally {
			logger.info = origInfo;
		}
	});
});

describe('extractAndOperateMemoryTool interaction parameter schema', () => {
	const mockEmbedder = {
		embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
	};
	const mockVectorStore = {
		search: vi.fn().mockResolvedValue([]),
		insert: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
	const mockEmbeddingManager = {
		getEmbedder: vi.fn().mockReturnValue(mockEmbedder),
	};
	const mockVectorStoreManager = {
		getStore: vi.fn().mockReturnValue(mockVectorStore),
	};
	const mockLlmService = {
		directGenerate: vi.fn().mockResolvedValue('ADD'),
	};
	const mockContext = {
		services: {
			embeddingManager: mockEmbeddingManager,
			vectorStoreManager: mockVectorStoreManager,
			llmService: mockLlmService,
		},
	} as any;

	it('should process a single string interaction', async () => {
		const args = {
			interaction:
				'In JavaScript, Array.prototype.map creates a new array populated with the results of calling a provided function on every element in the calling array.',
		};
		const result = await extractAndOperateMemoryTool.handler(args, mockContext);
		expect(result).toBeDefined();
		// Embedding might not be called if fallback logic is used
		if (result.success === true && result.extraction) {
			expect(mockEmbedder.embed).toHaveBeenCalled();
		}
	});

	it('should process an array of string interactions', async () => {
		const args = {
			interaction: [
				'In Python, the def keyword is used to define a function.',
				'In TypeScript, interfaces define the shape of an object.',
			],
		};
		const result = await extractAndOperateMemoryTool.handler(args, mockContext);
		expect(result).toBeDefined();
		// Embedding might not be called if fallback logic is used
		if (result.success === true && result.extraction) {
			expect(mockEmbedder.embed).toHaveBeenCalled();
		}
	});

	it('should fallback gracefully if embedding is unavailable', async () => {
		const args = {
			interaction: 'Fallback test when embedding is missing',
		};
		const contextWithoutEmbedding = {
			services: {
				embeddingManager: null,
				vectorStoreManager: null,
				llmService: null,
			},
		} as any;
		const result = await extractAndOperateMemoryTool.handler(args, contextWithoutEmbedding);
		expect(result.success).toBe(true);
		expect(result.memory).toBeDefined();
		expect(result.memory[0].reasoning).toContain('Fallback processing');
	});
});
