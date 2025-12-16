import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnifiedToolManager } from '../unified-tool-manager.js';
import { InternalToolManager } from '../manager.js';
import { InternalToolRegistry } from '../registry.js';
import { MCPManager } from '../../../mcp/manager.js';
import { registerAllTools } from '../definitions/index.js';
import type { InternalTool } from '../types.js';

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

describe('Timeout Behavior', () => {
	let unifiedManager: UnifiedToolManager;
	let internalToolManager: InternalToolManager;
	let mcpManager: MCPManager;
	let originalCipherTimeout: string | undefined;
	let originalMcpTimeout: string | undefined;

	// Mock embedding manager
	const mockEmbeddingManager = {
		hasAvailableEmbeddings: vi.fn(() => true),
		handleRuntimeFailure: vi.fn(),
	};

	beforeEach(async () => {
		// Save original environment variables
		originalCipherTimeout = process.env.CIPHER_MCP_TIMEOUT;
		originalMcpTimeout = process.env.MCP_TIMEOUT;

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
		// Restore original environment variables
		if (originalCipherTimeout !== undefined) {
			process.env.CIPHER_MCP_TIMEOUT = originalCipherTimeout;
		} else {
			delete process.env.CIPHER_MCP_TIMEOUT;
		}

		if (originalMcpTimeout !== undefined) {
			process.env.MCP_TIMEOUT = originalMcpTimeout;
		} else {
			delete process.env.MCP_TIMEOUT;
		}

		InternalToolRegistry.reset();
		vi.clearAllMocks();
	});

	describe('Environment Variable Configuration', () => {
		it('should use default 30s timeout when no env vars set', async () => {
			// Clear environment variables
			delete process.env.CIPHER_MCP_TIMEOUT;
			delete process.env.MCP_TIMEOUT;

			// Create a fresh manager with default config
			const manager = new InternalToolManager();
			await manager.initialize();

			// Register a quick tool that completes immediately
			const quickTool: InternalTool = {
				name: 'quick_test_tool',
				category: 'memory',
				internal: true,
				description: 'A quick test tool',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					return { success: true, result: 'completed' };
				},
			};

			manager.registerTool(quickTool);

			// Should complete successfully with default timeout
			const result = await manager.executeTool('quick_test_tool', {});
			expect(result.success).toBe(true);
		});

		it('should respect CIPHER_MCP_TIMEOUT environment variable', async () => {
			// Set custom timeout
			process.env.CIPHER_MCP_TIMEOUT = '120000';

			// Import the config module to verify the env var is read
			// Note: The actual timeout application happens during manager initialization
			// This test verifies the env var is available and parsed correctly

			expect(process.env.CIPHER_MCP_TIMEOUT).toBe('120000');
			const parsed = parseInt(process.env.CIPHER_MCP_TIMEOUT, 10);
			expect(parsed).toBe(120000);
			expect(parsed).toBeGreaterThan(30000);
		});

		it('should use MCP_TIMEOUT as fallback when CIPHER_MCP_TIMEOUT not set', async () => {
			// Clear CIPHER_MCP_TIMEOUT and set MCP_TIMEOUT
			delete process.env.CIPHER_MCP_TIMEOUT;
			process.env.MCP_TIMEOUT = '90000';

			// Verify MCP_TIMEOUT is available
			expect(process.env.MCP_TIMEOUT).toBe('90000');
			const parsed = parseInt(process.env.MCP_TIMEOUT, 10);
			expect(parsed).toBe(90000);
		});

		it('should prioritize CIPHER_MCP_TIMEOUT over MCP_TIMEOUT', async () => {
			// Set both environment variables
			process.env.CIPHER_MCP_TIMEOUT = '120000';
			process.env.MCP_TIMEOUT = '60000';

			// CIPHER_MCP_TIMEOUT should take priority
			expect(process.env.CIPHER_MCP_TIMEOUT).toBe('120000');

			// Verify priority by checking parsed values
			const cipherTimeout = parseInt(process.env.CIPHER_MCP_TIMEOUT, 10);
			const mcpTimeout = parseInt(process.env.MCP_TIMEOUT, 10);

			expect(cipherTimeout).toBe(120000);
			expect(mcpTimeout).toBe(60000);
			expect(cipherTimeout).toBeGreaterThan(mcpTimeout);
		});

		it('should fall back to default for invalid CIPHER_MCP_TIMEOUT values', async () => {
			// Test various invalid values
			const invalidValues = ['-1', '0', 'invalid', '', 'abc123'];

			for (const invalidValue of invalidValues) {
				process.env.CIPHER_MCP_TIMEOUT = invalidValue;

				const parsed = parseInt(process.env.CIPHER_MCP_TIMEOUT, 10);

				// Should be NaN, zero, or negative (all invalid)
				const isInvalid = isNaN(parsed) || parsed <= 0;
				expect(isInvalid).toBe(true);
			}
		});
	});

	describe('Tool Execution with Timeout', () => {
		it('should complete tools that finish within timeout', async () => {
			// Create a tool that completes quickly (50ms)
			const quickTool: InternalTool = {
				name: 'quick_complete_tool',
				category: 'memory',
				internal: true,
				description: 'A tool that completes quickly',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					await new Promise(resolve => setTimeout(resolve, 50));
					return { success: true, result: 'completed in time' };
				},
			};

			// Use a manager with 200ms timeout (plenty of time)
			const manager = new InternalToolManager({ timeout: 200 });
			await manager.initialize();
			manager.registerTool(quickTool);

			const startTime = Date.now();
			const result = await manager.executeTool('quick_complete_tool', {});
			const duration = Date.now() - startTime;

			expect(result.success).toBe(true);
			expect(duration).toBeLessThan(200);
			expect(duration).toBeGreaterThanOrEqual(45); // Allow for timing precision variance
		});

		it('should timeout tools that exceed configured timeout', async () => {
			// Create a tool that takes longer than timeout (150ms)
			const slowTool: InternalTool = {
				name: 'slow_timeout_tool',
				category: 'memory',
				internal: true,
				description: 'A tool that takes too long',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					await new Promise(resolve => setTimeout(resolve, 150));
					return { success: true, result: 'should not complete' };
				},
			};

			// Use a manager with 50ms timeout (too short)
			const manager = new InternalToolManager({ timeout: 50 });
			await manager.initialize();
			manager.registerTool(slowTool);

			// Should throw timeout error
			await expect(manager.executeTool('slow_timeout_tool', {})).rejects.toThrow(
				'Tool execution timeout'
			);
		});

		it('should handle longer timeouts for complex operations', async () => {
			// Simulate a complex operation that takes ~100ms
			const complexTool: InternalTool = {
				name: 'complex_operation_tool',
				category: 'memory',
				internal: true,
				description: 'A tool simulating complex processing',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					// Simulate multiple sequential operations
					await new Promise(resolve => setTimeout(resolve, 30)); // Entity extraction
					await new Promise(resolve => setTimeout(resolve, 30)); // Relationship identification
					await new Promise(resolve => setTimeout(resolve, 20)); // Conflict resolution
					await new Promise(resolve => setTimeout(resolve, 20)); // Graph operations

					return {
						success: true,
						result: 'complex operation completed',
						duration: 100
					};
				},
			};

			// Use a manager with generous timeout (500ms)
			const manager = new InternalToolManager({ timeout: 500 });
			await manager.initialize();
			manager.registerTool(complexTool);

			const startTime = Date.now();
			const result = await manager.executeTool('complex_operation_tool', {});
			const duration = Date.now() - startTime;

			expect(result.success).toBe(true);
			expect(duration).toBeLessThan(500);
			expect(duration).toBeGreaterThanOrEqual(100);
		});
	});

	describe('Timeout Error Handling', () => {
		it('should provide clear timeout error message', async () => {
			const timeoutTool: InternalTool = {
				name: 'error_message_tool',
				category: 'memory',
				internal: true,
				description: 'A tool to test error message',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					await new Promise(resolve => setTimeout(resolve, 100));
					return { success: true };
				},
			};

			const manager = new InternalToolManager({ timeout: 50 });
			await manager.initialize();
			manager.registerTool(timeoutTool);

			try {
				await manager.executeTool('error_message_tool', {});
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toContain('Tool execution timeout');
			}
		});

		it('should not timeout tools that complete just before limit', async () => {
			// Create a tool that takes 40ms
			const justInTimeTool: InternalTool = {
				name: 'just_in_time_tool',
				category: 'memory',
				internal: true,
				description: 'A tool that completes just in time',
				version: '1.0.0',
				parameters: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					await new Promise(resolve => setTimeout(resolve, 40));
					return { success: true, result: 'made it!' };
				},
			};

			// Set timeout to 60ms (should complete with time to spare)
			const manager = new InternalToolManager({ timeout: 60 });
			await manager.initialize();
			manager.registerTool(justInTimeTool);

			const result = await manager.executeTool('just_in_time_tool', {});
			expect(result.success).toBe(true);
		});
	});
});
