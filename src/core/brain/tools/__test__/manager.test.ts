import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InternalToolManager } from '../manager.js';
import { InternalToolRegistry } from '../registry.js';
import { InternalTool, InternalToolManagerConfig } from '../types.js';

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
describe('InternalToolManager', () => {
	let manager: InternalToolManager;
	let testTool: InternalTool;

	beforeEach(async () => {
		// Reset the registry singleton before each test
		InternalToolRegistry.reset();

		manager = new InternalToolManager();

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

		await manager.initialize();
	});

	afterEach(() => {
		// Clean up after each test
		InternalToolRegistry.reset();
	});

	describe('Initialization', () => {
		it('should initialize successfully', async () => {
			const newManager = new InternalToolManager();
			await newManager.initialize();

			expect(newManager.isInitialized()).toBe(true);
			expect(newManager.isEnabled()).toBe(true);
		});

		it('should handle being initialized multiple times', async () => {
			await manager.initialize();
			await manager.initialize();

			expect(manager.isInitialized()).toBe(true);
		});

		it('should respect disabled configuration', async () => {
			const config: InternalToolManagerConfig = { enabled: false };
			const disabledManager = new InternalToolManager(config);

			await disabledManager.initialize();

			expect(disabledManager.isEnabled()).toBe(false);
		});
	});

	describe('Tool Registration', () => {
		it('should register a tool successfully', () => {
			const result = manager.registerTool(testTool);

			expect(result.success).toBe(true);
			expect(result.message).toContain('registered successfully');
		});

		it('should prevent duplicate tool registration', () => {
			manager.registerTool(testTool);
			const result = manager.registerTool(testTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('already registered');
			expect(result.conflictedWith).toBeDefined();
		});

		it('should validate tool structure', () => {
			const invalidTool = {
				...testTool,
				category: 'invalid' as any,
			};

			const result = manager.registerTool(invalidTool);

			expect(result.success).toBe(false);
			expect(result.message).toContain('validation failed');
		});

		it('should normalize tool names with cipher_ prefix', () => {
			const result = manager.registerTool(testTool);
			expect(result.success).toBe(true);

			const retrievedTool = manager.getTool('test_tool');
			expect(retrievedTool?.name).toBe('cipher_test_tool');
		});
	});

	describe('Tool Unregistration', () => {
		beforeEach(() => {
			manager.registerTool(testTool);
		});

		it('should unregister a tool successfully', () => {
			const result = manager.unregisterTool('test_tool');
			expect(result).toBe(true);

			const tool = manager.getTool('test_tool');
			expect(tool).toBeUndefined();
		});

		it('should handle unregistering non-existent tool', () => {
			const result = manager.unregisterTool('non_existent_tool');
			expect(result).toBe(false);
		});
	});

	describe('Tool Retrieval', () => {
		beforeEach(() => {
			manager.registerTool(testTool);
		});

		it('should retrieve all tools', () => {
			const tools = manager.getAllTools();
			expect(Object.keys(tools)).toHaveLength(1);
			expect(tools['cipher_test_tool']).toBeDefined();
		});

		it('should retrieve tool by name', () => {
			const tool = manager.getTool('test_tool');
			expect(tool).toBeDefined();
			expect(tool?.name).toBe('cipher_test_tool');
		});

		it('should retrieve tools by category', () => {
			const memoryTools = manager.getToolsByCategory('memory');
			expect(Object.keys(memoryTools)).toHaveLength(1);

			const sessionTools = manager.getToolsByCategory('session');
			expect(Object.keys(sessionTools)).toHaveLength(0);
		});

		it('should check if tool is internal', () => {
			expect(manager.isInternalTool('cipher_test_tool')).toBe(true);
			expect(manager.isInternalTool('external_tool')).toBe(false);
		});
	});

	describe('Tool Execution', () => {
		beforeEach(() => {
			manager.registerTool(testTool);
		});

		it('should execute a tool successfully', async () => {
			const result = await manager.executeTool('test_tool', { message: 'Hello' });

			expect(result).toEqual({ success: true, message: 'Hello' });
		});

		it('should handle tool execution errors', async () => {
			const errorTool: InternalTool = {
				...testTool,
				name: 'error_tool',
				handler: async () => {
					throw new Error('Tool execution failed');
				},
			};

			manager.registerTool(errorTool);

			await expect(manager.executeTool('error_tool', {})).rejects.toThrow(
				'Internal tool execution failed'
			);
		});

		it('should handle execution timeout', async () => {
			const timeoutTool: InternalTool = {
				...testTool,
				name: 'timeout_tool',
				handler: async () => {
					await new Promise(resolve => setTimeout(resolve, 100));
					return { success: true };
				},
			};

			const quickManager = new InternalToolManager({ timeout: 50 });
			await quickManager.initialize();
			quickManager.registerTool(timeoutTool);

			await expect(quickManager.executeTool('timeout_tool', {})).rejects.toThrow(
				'Tool execution timeout'
			);
		});

		it('should execute tool with context', async () => {
			const contextTool: InternalTool = {
				...testTool,
				name: 'context_tool',
				handler: async (args: any) => {
					return { success: true, receivedArgs: args };
				},
			};

			manager.registerTool(contextTool);

			const result = await manager.executeTool(
				'context_tool',
				{ test: 'data' },
				{ sessionId: 'test-session', metadata: { user: 'test' } }
			);

			expect(result.success).toBe(true);
			expect(result.receivedArgs).toEqual({ test: 'data' });
		});

		it('should throw error for non-existent tool', async () => {
			await expect(manager.executeTool('non_existent', {})).rejects.toThrow(
				"Internal tool 'cipher_non_existent' not found"
			);
		});
	});

	describe('Statistics', () => {
		beforeEach(() => {
			manager.registerTool(testTool);
		});

		it('should track tool execution statistics', async () => {
			// Execute the tool multiple times
			await manager.executeTool('test_tool', { message: 'test1' });
			await manager.executeTool('test_tool', { message: 'test2' });

			const stats = manager.getToolStats('test_tool');
			expect(stats).toBeDefined();
			expect(stats?.totalExecutions).toBe(2);
			expect(stats?.successfulExecutions).toBe(2);
			expect(stats?.failedExecutions).toBe(0);
		});

		it('should track failed executions', async () => {
			const errorTool: InternalTool = {
				...testTool,
				name: 'failing_tool',
				handler: async () => {
					throw new Error('Intentional failure');
				},
			};

			manager.registerTool(errorTool);

			try {
				await manager.executeTool('failing_tool', {});
			} catch {
				// Expected to fail
			}

			const stats = manager.getToolStats('failing_tool');
			expect(stats?.totalExecutions).toBe(1);
			expect(stats?.successfulExecutions).toBe(0);
			expect(stats?.failedExecutions).toBe(1);
		});

		it('should provide manager statistics', async () => {
			await manager.executeTool('test_tool', { message: 'test' });

			const managerStats = manager.getManagerStats();
			expect(managerStats.totalTools).toBe(1);
			expect(managerStats.toolsByCategory.memory).toBe(1);
			expect(managerStats.totalExecutions).toBe(1);
		});

		it('should clear statistics', async () => {
			await manager.executeTool('test_tool', { message: 'test' });

			manager.clearStats();

			const stats = manager.getToolStats('test_tool');
			expect(stats).toBeUndefined();
		});
	});

	describe('Configuration', () => {
		it('should use default configuration', () => {
			const config = manager.getConfig();

			expect(config.enabled).toBe(true);
			expect(config.timeout).toBe(30000);
			expect(config.enableCache).toBe(true);
			expect(config.cacheTimeout).toBe(300000);
		});

		it('should accept custom configuration', () => {
			const customConfig: InternalToolManagerConfig = {
				enabled: true,
				timeout: 15000,
				enableCache: false,
				cacheTimeout: 60000,
			};

			const customManager = new InternalToolManager(customConfig);
			const config = customManager.getConfig();

			expect(config.timeout).toBe(15000);
			expect(config.enableCache).toBe(false);
			expect(config.cacheTimeout).toBe(60000);
		});
	});

	describe('Shutdown', () => {
		it('should shutdown gracefully', async () => {
			manager.registerTool(testTool);
			await manager.executeTool('test_tool', { message: 'test' });

			await manager.shutdown();

			expect(manager.isInitialized()).toBe(false);

			// Should throw error when trying to use after shutdown
			expect(() => manager.getAllTools()).toThrow('must be initialized');
		});

		it('should handle shutdown when not initialized', async () => {
			const newManager = new InternalToolManager();

			// Should not throw
			await newManager.shutdown();
		});
	});

	describe('Error Handling', () => {
		it('should throw error when using uninitialized manager', () => {
			const uninitializedManager = new InternalToolManager();

			expect(() => uninitializedManager.registerTool(testTool)).toThrow('must be initialized');
		});

		it('should throw error when using disabled manager', async () => {
			const disabledManager = new InternalToolManager({ enabled: false });
			await disabledManager.initialize();

			expect(() => disabledManager.registerTool(testTool)).toThrow('disabled by configuration');
		});
	});
});
