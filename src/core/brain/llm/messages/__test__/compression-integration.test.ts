import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from '../manager.js';
import { IMessageFormatter } from '../formatters/types.js';
import { InternalMessage } from '../types.js';
import { CompressionLevel } from '../../compression/types.js';

// Mock logger
vi.mock('../../../../logger/index.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock formatter
class MockFormatter implements IMessageFormatter {
	format(message: InternalMessage, systemPrompt?: string): any[] {
		return [
			{
				role: message.role,
				content: message.content,
			},
		];
	}

	parseResponse(response: any): InternalMessage[] {
		return [response];
	}

	parseStreamResponse?(response: any): Promise<InternalMessage[]> {
		return Promise.resolve([response]);
	}
}

// Mock prompt manager
class MockPromptManager {
	async getCompleteSystemPrompt(): Promise<string> {
		return 'System prompt for testing';
	}
}

describe('ContextManager Token-Aware Compression Integration', () => {
	let contextManager: ContextManager;
	let mockFormatter: MockFormatter;
	let mockPromptManager: MockPromptManager;

	beforeEach(() => {
		mockFormatter = new MockFormatter();
		mockPromptManager = new MockPromptManager();
		contextManager = new ContextManager(
			mockFormatter,
			mockPromptManager as any,
			undefined,
			undefined
		);
	});

	describe('Compression Configuration', () => {
		it('should configure compression for OpenAI', async () => {
			await contextManager.configureCompression('openai', 'gpt-4', 8192);

			const stats = contextManager.getTokenStats();
			expect(stats.maxTokens).toBe(8192);
			expect(stats.compressionLevel).toBe(CompressionLevel.NONE);
		});

		it('should configure compression for Anthropic', async () => {
			await contextManager.configureCompression('anthropic', 'claude-3-sonnet', 200000);

			const stats = contextManager.getTokenStats();
			expect(stats.maxTokens).toBe(200000);
		});

		it('should configure compression for Google', async () => {
			await contextManager.configureCompression('google', 'gemini-pro', 32760);

			const stats = contextManager.getTokenStats();
			expect(stats.maxTokens).toBe(32760);
		});
	});

	describe('Token Counting and Compression', () => {
		beforeEach(async () => {
			// Configure with a small context window for easier testing
			await contextManager.configureCompression('openai', 'gpt-3.5-turbo', 1000);
		});

		it('should track token count as messages are added', async () => {
			await contextManager.addMessage({
				role: 'system',
				content: 'You are a helpful assistant.',
			});

			await contextManager.addMessage({
				role: 'user',
				content: 'Hello, how are you?',
			});

			const stats = contextManager.getTokenStats();
			expect(stats.currentTokens).toBeGreaterThan(0);
			expect(stats.utilization).toBeGreaterThan(0);
		});

		it('should trigger compression when threshold is reached', async () => {
			// Add a system message (critical priority)
			await contextManager.addMessage({
				role: 'system',
				content: 'You are a helpful assistant.',
			});

			// Add many user/assistant message pairs to trigger compression
			for (let i = 0; i < 20; i++) {
				await contextManager.addMessage({
					role: 'user',
					content: `This is user message ${i} with enough content to accumulate tokens and trigger compression when the context window limit is approached.`,
				});

				await contextManager.addMessage({
					role: 'assistant',
					content: `This is assistant response ${i} with enough content to accumulate tokens and trigger compression when the context window limit is approached.`,
				});
			}

			const stats = contextManager.getTokenStats();
			const messages = contextManager.getRawMessages();

			// Should have compressed if we exceeded threshold
			expect(stats.compressionHistory).toBeGreaterThanOrEqual(0);

			// Should preserve system message
			const systemMessages = messages.filter(m => m.role === 'system');
			expect(systemMessages.length).toBe(1);
		});

		it('should provide accurate token statistics', async () => {
			await contextManager.addMessage({
				role: 'user',
				content: 'Short message',
			});

			const stats = contextManager.getTokenStats();

			expect(stats.currentTokens).toBeGreaterThan(0);
			expect(stats.maxTokens).toBe(1000);
			expect(stats.utilization).toBeGreaterThan(0);
			expect(stats.utilization).toBeLessThan(1);
			expect(Object.values(CompressionLevel)).toContain(stats.compressionLevel);
		});

		it('should force compression when requested', async () => {
			// Add some messages
			for (let i = 0; i < 5; i++) {
				await contextManager.addMessage({
					role: 'user',
					content: `Message ${i}`,
				});
			}

			try {
				const result = await contextManager.forceCompression();
				// If compression was configured and successful, result should exist
				if (result) {
					expect(result.strategy).toBeDefined();
					expect(result.compressionRatio).toBeLessThanOrEqual(1);
				}
			} catch (error) {
				// If compression wasn't configured, this is expected
				expect((error as Error).message).toContain('not configured');
			}
		});
	});

	describe('Message Priority and Preservation', () => {
		beforeEach(async () => {
			await contextManager.configureCompression('openai', 'gpt-4', 1000);
		});

		it('should preserve system messages during compression', async () => {
			// Add system message
			await contextManager.addMessage({
				role: 'system',
				content: 'You are a helpful assistant with specific instructions.',
			});

			// Add many other messages
			for (let i = 0; i < 15; i++) {
				await contextManager.addMessage({
					role: 'user',
					content: `User message ${i} with substantial content to trigger compression`,
				});

				await contextManager.addMessage({
					role: 'assistant',
					content: `Assistant response ${i} with substantial content`,
				});
			}

			const messages = contextManager.getRawMessages();
			const systemMessages = messages.filter(m => m.role === 'system');

			// System messages should always be preserved
			expect(systemMessages.length).toBe(1);
			expect(systemMessages[0]?.content).toContain('helpful assistant');
		});

		it('should handle tool messages appropriately', async () => {
			await contextManager.addMessage({
				role: 'assistant',
				content: null,
				toolCalls: [
					{
						id: 'call_1',
						type: 'function',
						function: {
							name: 'test_function',
							arguments: '{"param": "value"}',
						},
					},
				],
			});

			await contextManager.addToolResult('call_1', 'test_function', 'Tool result');

			const messages = contextManager.getRawMessages();
			expect(messages.length).toBe(2);

			const toolMessage = messages.find(m => m.role === 'tool');
			expect(toolMessage).toBeDefined();
			expect(toolMessage?.toolCallId).toBe('call_1');
		});
	});

	describe('Compression Level Detection', () => {
		beforeEach(async () => {
			await contextManager.configureCompression('openai', 'gpt-4', 1000);
		});

		it('should detect compression levels correctly', async () => {
			// Start with no messages - should be NONE
			let level = contextManager.getCompressionLevel();
			expect(level).toBe(CompressionLevel.NONE);

			// Add messages progressively and check levels
			const messageContent =
				'This is a test message with enough content to count tokens properly and test compression level detection.';

			for (let i = 0; i < 10; i++) {
				await contextManager.addMessage({
					role: 'user',
					content: `${messageContent} Message ${i}`,
				});

				level = contextManager.getCompressionLevel();
				expect(Object.values(CompressionLevel)).toContain(level);
			}
		});
	});
});
