import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InternalToolRegistry } from '../registry.js';
import { InternalTool } from '../types.js';

// Mock the logger to avoid console output during tests
vi.mock('../../../logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

/* eslint-env vitest */
describe('InternalToolRegistry', () => {
	let registry: InternalToolRegistry;
	let testTool: InternalTool;

	beforeEach(async () => {
		// Reset singleton and get fresh instance
		InternalToolRegistry.reset();
		registry = InternalToolRegistry.getInstance();

		// Create a test tool
		testTool = {
			name: 'test_tool',
			category: 'memory',
			internal: true,
			description: 'A test tool for unit testing',
			parameters: {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description: 'Test message',
					},
				},
				required: ['message'],
			},
			handler: async (args: { message: string }) => {
				return { success: true, message: args.message };
			},
		};

		await registry.initialize();
	});

	afterEach(() => {
		InternalToolRegistry.reset();
	});

	describe('Singleton Pattern', () => {
		it('should return the same instance', () => {
			const instance1 = InternalToolRegistry.getInstance();
			const instance2 = InternalToolRegistry.getInstance();

			expect(instance1).toBe(instance2);
		});

		it('should reset singleton correctly', () => {
			const instance1 = InternalToolRegistry.getInstance();
			InternalToolRegistry.reset();
			const instance2 = InternalToolRegistry.getInstance();

			expect(instance1).not.toBe(instance2);
		});
	});

	describe('Initialization', () => {
		it('should initialize successfully', async () => {
			const newRegistry = InternalToolRegistry.getInstance();
			await newRegistry.initialize();

			const stats = newRegistry.getRegistryStats();
			expect(stats.initialized).toBe(true);
		});

		it('should handle multiple initialization calls', async () => {
			await registry.initialize();
			await registry.initialize();

			const stats = registry.getRegistryStats();
			expect(stats.initialized).toBe(true);
		});
	});

	describe('Tool Registration', () => {
		it('should register a valid tool', () => {
			const result = registry.registerTool(testTool);

			expect(result.success).toBe(true);
			expect(result.message).toContain('registered successfully');
		});

		it('should normalize tool names with cipher_ prefix', () => {
			registry.registerTool(testTool);

			const tool = registry.getTool('test_tool');
			expect(tool?.name).toBe('cipher_test_tool');
		});

		it('should prevent duplicate registrations', () => {
			registry.registerTool(testTool);
			const result = registry.registerTool(testTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('already registered');
			expect(result.conflictedWith).toBe('cipher_test_tool');
		});

		it('should validate required fields', () => {
			const invalidTool = { ...testTool, name: '' };
			const result = registry.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('validation failed');
		});

		it('should validate tool category', () => {
			const invalidTool = { ...testTool, category: 'invalid' as any };
			const result = registry.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('category must be one of');
		});

		it('should validate internal flag', () => {
			const invalidTool = { ...testTool, internal: false as any };
			const result = registry.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('internal property set to true');
		});

		it('should validate handler function', () => {
			const invalidTool = { ...testTool, handler: 'not a function' as any };
			const result = registry.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('handler is required and must be a function');
		});

		it('should validate parameters structure', () => {
			const invalidTool = { ...testTool, parameters: { type: 'string' } as any };
			const result = registry.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('parameters type must be "object"');
		});
	});

	describe('Tool Unregistration', () => {
		beforeEach(() => {
			registry.registerTool(testTool);
		});

		it('should unregister an existing tool', () => {
			const result = registry.unregisterTool('test_tool');
			expect(result).toBe(true);

			const tool = registry.getTool('test_tool');
			expect(tool).toBeUndefined();
		});

		it('should handle unregistering non-existent tool', () => {
			const result = registry.unregisterTool('non_existent');
			expect(result).toBe(false);
		});

		it('should remove from category index', () => {
			registry.unregisterTool('test_tool');

			const memoryTools = registry.getToolsByCategory('memory');
			expect(Object.keys(memoryTools)).toHaveLength(0);
		});
	});

	describe('Tool Retrieval', () => {
		beforeEach(() => {
			registry.registerTool(testTool);

			// Add another tool for testing
			const sessionTool: InternalTool = {
				...testTool,
				name: 'session_tool',
				category: 'session',
			};
			registry.registerTool(sessionTool);
		});

		it('should retrieve tool by name', () => {
			const tool = registry.getTool('test_tool');
			expect(tool).toBeDefined();
			expect(tool?.category).toBe('memory');
		});

		it('should return undefined for non-existent tool', () => {
			const tool = registry.getTool('non_existent');
			expect(tool).toBeUndefined();
		});

		it('should retrieve all tools', () => {
			const tools = registry.getAllTools();
			expect(Object.keys(tools)).toHaveLength(2);
			expect(tools['cipher_test_tool']).toBeDefined();
			expect(tools['cipher_session_tool']).toBeDefined();
		});

		it('should retrieve tools by category', () => {
			const memoryTools = registry.getToolsByCategory('memory');
			const sessionTools = registry.getToolsByCategory('session');
			const systemTools = registry.getToolsByCategory('system');

			expect(Object.keys(memoryTools)).toHaveLength(1);
			expect(Object.keys(sessionTools)).toHaveLength(1);
			expect(Object.keys(systemTools)).toHaveLength(0);
		});

		it('should check if tool exists', () => {
			expect(registry.hasTool('test_tool')).toBe(true);
			expect(registry.hasTool('non_existent')).toBe(false);
		});

		it('should identify internal tools', () => {
			expect(registry.isInternalTool('cipher_test_tool')).toBe(true);
			expect(registry.isInternalTool('external_tool')).toBe(false);
		});
	});

	describe('Tool Names and Counting', () => {
		beforeEach(() => {
			registry.registerTool(testTool);

			const sessionTool: InternalTool = {
				...testTool,
				name: 'session_tool',
				category: 'session',
			};
			registry.registerTool(sessionTool);
		});

		it('should get correct tool count', () => {
			expect(registry.getToolCount()).toBe(2);
		});

		it('should get tool count by category', () => {
			const counts = registry.getToolCountByCategory();
			expect(counts.memory).toBe(1);
			expect(counts.session).toBe(1);
			expect(counts.system).toBe(0);
		});

		it('should get all tool names', () => {
			const names = registry.getToolNames();
			expect(names).toContain('cipher_test_tool');
			expect(names).toContain('cipher_session_tool');
			expect(names).toHaveLength(2);
		});

		it('should get tool names by category', () => {
			const memoryNames = registry.getToolNamesByCategory('memory');
			const sessionNames = registry.getToolNamesByCategory('session');

			expect(memoryNames).toEqual(['cipher_test_tool']);
			expect(sessionNames).toEqual(['cipher_session_tool']);
		});
	});

	describe('Registry Management', () => {
		beforeEach(() => {
			registry.registerTool(testTool);
		});

		it('should clear all tools', () => {
			registry.clear();

			expect(registry.getToolCount()).toBe(0);
			const tools = registry.getAllTools();
			expect(Object.keys(tools)).toHaveLength(0);
		});

		it('should provide registry statistics', () => {
			const stats = registry.getRegistryStats();

			expect(stats.totalTools).toBe(1);
			expect(stats.toolsByCategory.memory).toBe(1);
			expect(stats.initialized).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		it('should handle tools with cipher_ prefix already', () => {
			const prefixedTool: InternalTool = {
				...testTool,
				name: 'cipher_prefixed_tool',
			};

			const result = registry.registerTool(prefixedTool);
			expect(result.success).toBe(true);

			const tool = registry.getTool('cipher_prefixed_tool');
			expect(tool?.name).toBe('cipher_prefixed_tool');
		});

		it('should handle empty tool parameters', () => {
			const toolWithEmptyParams: InternalTool = {
				...testTool,
				parameters: {
					type: 'object',
					properties: {},
				},
			};

			const result = registry.registerTool(toolWithEmptyParams);
			expect(result.success).toBe(true);
		});

		it('should handle registration errors gracefully', () => {
			const toolWithBadHandler: InternalTool = {
				...testTool,
				handler: null as any,
			};

			const result = registry.registerTool(toolWithBadHandler);
			expect(result.success).toBe(false);
			expect(result.message).toContain('handler is required');
		});
	});
});
